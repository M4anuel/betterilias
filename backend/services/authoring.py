"""Repository authoring shared by courses and folders, with verified writes."""
from urllib.parse import urlencode

import httpx

from backend.config import settings
from backend.i18n import t
from backend.schemas import AuthoringResult, CreateFolderRequest
from backend.scrapers.authoring import parse_authoring_context, parse_creation_form
from backend.scrapers.dumper import dump_failed_html
from backend.scrapers.materials import parse_course_materials
from backend.services.assignment_multipart import encode_assignment_form


class AuthoringError(Exception):
    def __init__(self, key: str, status_code: int = 409):
        super().__init__(t(key))
        self.status_code = status_code


class AuthoringMixin:
    async def _authoring_get(self, client, url):
        try:
            response = await client.get(url)
            self._check_response_for_session_loss(response, url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise AuthoringError('authoring.load_failed', 502) from exc
        return response

    async def _authoring_container(self, client, ref_id):
        url = f'{settings.ilias_base_url}/ilias.php?' + urlencode({'baseClass': 'ilRepositoryGUI', 'ref_id': ref_id})
        return await self._authoring_get(client, url)

    async def get_authoring_context(self, ref_id):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            response = await self._authoring_container(client, ref_id)
            return parse_authoring_context(response.text, ref_id)

    async def _creation_context(self, client, ref_id, object_type):
        container = await self._authoring_container(client, ref_id)
        context = parse_authoring_context(container.text, ref_id)
        if object_type not in context.creation_urls:
            raise AuthoringError('authoring.permission_denied', 403)
        response = await self._authoring_get(client, context.creation_urls[object_type])
        form = parse_creation_form(response.text, ref_id, object_type)
        return container, form

    async def get_file_creation_options(self, ref_id):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            _, form = await self._creation_context(client, ref_id, 'file')
            return {'licenses': [{k: v for k, v in option.items() if k != 'field'} for option in form.licenses]}

    async def get_folder_creation_options(self, ref_id):
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            _, form = await self._creation_context(client, ref_id, 'fold')
            return {'templates': form.templates}

    async def _submit_creation(self, client, ref_id, before, form, title, item_type):
        # No automatic retry: a timeout may mean the native save already succeeded.
        body, content_type = encode_assignment_form(form.values, [])
        try:
            response = await client.post(form.action, content=body, headers={'Content-Type': content_type})
            self._check_response_for_session_loss(response, form.action)
            response.raise_for_status()
            after = await self._authoring_container(client, ref_id)
            previous = {item.ref_id for item in parse_course_materials(before.text, ref_id).items}
            created = [item for item in parse_course_materials(after.text, ref_id).items
                       if item.ref_id not in previous and item.item_type == item_type and item.title == title]
            if len(created) == 1:
                return AuthoringResult(items=created)
            dump_failed_html(response.text, 'authoring_unconfirmed')
        except (httpx.HTTPError, AuthoringError) as exc:
            raise AuthoringError('authoring.uncertain', 502) from exc
        raise AuthoringError('authoring.uncertain', 502)

    async def create_folder(self, ref_id: str, request: CreateFolderRequest):
        self._ensure_authenticated()
        title = request.title.strip()
        if not title:
            raise AuthoringError('authoring.title_required', 400)
        async with self.session_manager.get_http_client() as client:
            before, form = await self._creation_context(client, ref_id, 'fold')
            form.values[form.title_field] = title
            form.values[form.description_field] = request.description
            template = request.template_id or form.values.get(form.template_field)
            if template not in [option['value'] for option in form.templates]:
                raise AuthoringError('authoring.view_unavailable', 409)
            form.values[form.template_field] = template
            return await self._submit_creation(client, ref_id, before, form, title, 'fold')

    async def upload_course_file(self, ref_id, upload, license_value):
        self._ensure_authenticated()
        # Stream the spooled UploadFile to httpx; avoid reading large lectures into memory.
        filename = (upload.filename or '').replace('\\', '/').rsplit('/', 1)[-1]
        if not filename or any(c in filename for c in '\r\n'):
            raise AuthoringError('authoring.invalid_file', 400)
        if upload.size is not None and upload.size >= 900_000_000:
            raise AuthoringError('authoring.select_limit', 400)
        async with self.session_manager.get_http_client() as client:
            before, form = await self._creation_context(client, ref_id, 'file')
            license_option = next((o for o in form.licenses if o['value'] == license_value), None)
            if license_option is None:
                raise AuthoringError('authoring.license_unavailable', 400)
            try:
                response = await client.post(form.upload_url, files={'file[0]': (filename, upload.file, upload.content_type or 'application/octet-stream')})
                self._check_response_for_session_loss(response, form.upload_url)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise AuthoringError('authoring.upload_rejected', 502) from exc
            try:
                result = response.json()
                if isinstance(result, list) and len(result) == 1:
                    result = result[0]
                if result.get('status') != 1 or not result.get('file_id'):
                    raise ValueError('Native upload rejected')
            except (ValueError, AttributeError) as exc:
                raise AuthoringError('authoring.upload_rejected', 502) from exc
            # These parallel metadata arrays are the real file widget's submission format.
            form.values = {k: v for k, v in form.values.items() if k not in form.file_fields}
            form.values.update({form.file_fields[0]: filename,
                                form.file_fields[1]: '',
                                form.file_fields[2]: str(result['file_id']),
                                license_option['field']: license_value})
            return await self._submit_creation(client, ref_id, before, form, filename, 'file')
