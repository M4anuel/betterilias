"""Verified repository management; native URLs and confirmation fields stay server-side."""
import hashlib
import json
import logging
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

from backend.schemas import DeleteReview, DeleteReviewItem, ManagedMaterial, ManagementResponse
from backend.scrapers.authoring import native_url, parse_authoring_context
from backend.scrapers.dumper import dump_failed_html
from backend.scrapers.management import parse_management, parse_sorting, parse_delete_confirmation
from backend.scrapers.materials import parse_course_materials
from backend.services.authoring import AuthoringError

logger = logging.getLogger('ilias.management')


def revision(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def order_ids(form) -> list[str]:
    return sorted(form.positions, key=lambda ref: float(form.positions[ref][1]))


def order_revision(form) -> str:
    return revision(form.positions)


class ManagementMixin:
    async def _post_management(self, client, action, values, ref_id):
        # 307/308 redirects must never replay a destructive POST automatically.
        response = await client.post(action, content=urlencode(values),
                                     headers={'Content-Type': 'application/x-www-form-urlencoded'}, follow_redirects=False)
        self._check_response_for_session_loss(response, action)
        if response.status_code in (301, 302, 303) and response.headers.get('location'):
            try:
                target = native_url(urljoin(str(response.url), response.headers['location']), ref_id)
            except ValueError as exc:
                raise AuthoringError('management.form_changed', 502) from exc
            return await self._authoring_get(client, target)
        response.raise_for_status()
        return response

    async def _load_management(self, client, ref_id, required=True):
        response = await self._authoring_container(client, ref_id)
        context = parse_authoring_context(response.text, ref_id)
        form = parse_management(response.text, ref_id)
        if context.manage_url and form is None:
            response = await self._authoring_get(client, context.manage_url)
            form = parse_management(response.text, ref_id)
            managed_context = parse_authoring_context(response.text, ref_id)
            for attribute in ('manage_url', 'sorting_url', 'content_url'):
                if not getattr(managed_context, attribute):
                    setattr(managed_context, attribute, getattr(context, attribute))
            context = managed_context
        if required and form is None:
            raise AuthoringError('management.not_allowed', 403)
        if form and context.content_url:
            content = await self._authoring_get(client, context.content_url)
            content_context = parse_authoring_context(content.text, ref_id)
            context.page_editor_url = content_context.page_editor_url
            context.can_edit_page = content_context.can_edit_page
            if content_context.creation_urls:
                context.creation_urls = content_context.creation_urls
                context.creatable_types = content_context.creatable_types
                context.can_create = True
        return context, form, response

    async def _load_sorting(self, client, context):
        if not context.sorting_url:
            return None
        try:
            response = await self._authoring_get(client, context.sorting_url)
            return parse_sorting(response.text, context.ref_id)
        finally:
            if context.content_url:
                await self._authoring_get(client, context.content_url)

    async def get_management(self, ref_id):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            context, form, response = await self._load_management(client, ref_id, required=False)
            if not form and not context.can_create and not context.can_edit_page and not context.can_manage:
                raise AuthoringError('management.not_allowed', 403)
            items = form.items if form else [ManagedMaterial(**item.model_dump()) for item in parse_course_materials(response.text, ref_id).items]
            sorting = await self._load_sorting(client, context)
            editor_url = None
            if context.page_editor_url:
                parts = urlparse(context.page_editor_url)
                editor_url = urlunparse(parts._replace(query=urlencode([(k, v) for k, v in parse_qsl(parts.query) if k.lower() != 'rtoken'])))
            return ManagementResponse(ref_id=ref_id, authoring=context, items=items, can_sort=bool(sorting and sorting.positions and set(sorting.positions) <= {item.ref_id for item in items}),
                                      order=order_ids(sorting) if sorting else [],
                                      order_revision=order_revision(sorting) if sorting else '', editor_url=editor_url)

    async def _review_selection(self, client, ref_id, item_ids):
        if len(item_ids) != len(set(item_ids)) or any(not ref.isdigit() for ref in item_ids):
            raise AuthoringError('management.invalid_selection', 400)
        _, form, _ = await self._load_management(client, ref_id)
        selected = {item.ref_id: item for item in form.items if item.ref_id in item_ids}
        if set(selected) != set(item_ids) or any(not item.can_delete for item in selected.values()):
            raise AuthoringError('management.invalid_selection', 403)
        seen = {ref_id}
        count = 0

        async def inspect(item):
            nonlocal count
            count += 1
            if item.ref_id in seen or count > 500:
                raise AuthoringError('management.inspection_incomplete', 409)
            seen.add(item.ref_id)
            children = []
            if item.item_type in ('fold', 'grp', 'crs', 'cat', 'sess', 'lso', 'itgr'):
                _, child_form, _ = await self._load_management(client, item.ref_id)
                for child in sorted(child_form.items, key=lambda entry: entry.ref_id):
                    children.append(await inspect(child))
            elif item.item_type == 'other':
                raise AuthoringError('management.inspection_incomplete', 409)
            return DeleteReviewItem(ref_id=item.ref_id, title=item.title, item_type=item.item_type, children=children)

        review_items = [await inspect(selected[ref]) for ref in sorted(selected)]
        snapshot = [item.model_dump() for item in review_items]
        return DeleteReview(items=review_items, revision=revision({'parent': ref_id, 'items': snapshot}),
                            descendants=count-len(review_items)), form

    async def review_material_deletion(self, ref_id, item_ids):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            review, _ = await self._review_selection(client, ref_id, item_ids)
            return review

    async def delete_materials(self, ref_id, request):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            review, form = await self._review_selection(client, ref_id, request.item_ids)
            if review.revision != request.revision:
                raise AuthoringError('management.contents_changed', 409)
            # The first native POST only opens ILIAS's confirmation. Never invent the
            # second URL or its input names (modern ILIAS uses generated hidden fields).
            values = form.values + [('id[]', ref) for ref in request.item_ids] + [('cmd[delete]', 'Delete')]
            try:
                response = await self._post_management(client, form.action, values, ref_id)
            except httpx.HTTPError as exc:
                raise AuthoringError('management.inspection_incomplete', 502) from exc
            confirmation = parse_delete_confirmation(response.text, ref_id, set(request.item_ids))
            # Reinspect after the native modal, before crossing the deletion boundary.
            current, _ = await self._review_selection(client, ref_id, request.item_ids)
            if current.revision != review.revision:
                raise AuthoringError('management.contents_changed', 409)
            try:
                response = await self._post_management(client, confirmation.action, confirmation.values, ref_id)
                _, remaining, _ = await self._load_management(client, ref_id)
                remaining_ids = {item.ref_id for item in remaining.items}
                if remaining_ids.intersection(request.item_ids):
                    dump_failed_html(response.text, 'repository_deletion_unconfirmed')
                    raise AuthoringError('management.delete_uncertain', 502)
            except (httpx.HTTPError, AuthoringError) as exc:
                raise AuthoringError('management.delete_uncertain', 502) from exc
            logger.info('Deleted repository items parent=%s items=%s', ref_id, [(item.ref_id, item.title) for item in review.items])
            return {'success': True, 'deleted_ids': request.item_ids, 'affected': review.items}

    async def save_material_order(self, ref_id, request):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            context, _, _ = await self._load_management(client, ref_id, required=False)
            form = await self._load_sorting(client, context)
            if not form or not form.positions:
                raise AuthoringError('management.sort_unavailable', 403)
            if len(request.item_ids) != len(set(request.item_ids)) or set(request.item_ids) != set(form.positions):
                raise AuthoringError('management.contents_changed', 409)
            if order_revision(form) != request.revision:
                raise AuthoringError('management.contents_changed', 409)
            values = form.values + [(form.positions[ref][0], str((index+1)*10)) for index, ref in enumerate(request.item_ids)]
            values.append(('cmd[saveSorting]', 'Save Order'))
            try:
                response = await self._post_management(client, form.action, values, ref_id)
                saved = await self._load_sorting(client, context)
                if not saved or order_ids(saved) != request.item_ids:
                    dump_failed_html(response.text, 'repository_order_unconfirmed')
                    raise AuthoringError('management.order_uncertain', 502)
            except (httpx.HTTPError, AuthoringError) as exc:
                raise AuthoringError('management.order_uncertain', 502) from exc
            return {'success': True}
