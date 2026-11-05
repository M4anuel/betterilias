"""Offline multi-process ILIAS traffic simulation. Never contacts a network.

python scripts/load_outbound.py --users 10 25 50 100 --workers 2 --rate 50
Use --rate 5 --queue-timeout 120 to measure the default rate at larger loads.
Each user reads a dashboard/course/exercise and downloads a file. Two concurrent
course reads test coalescing; one TA additionally downloads eight files.
"""
import argparse
import asyncio
from dataclasses import asdict
import json
import multiprocessing
from pathlib import Path
import queue
import statistics
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from backend.config import settings
from backend.outbound_budget import BudgetPolicy, OutboundBudget, OutboundUnavailable
from backend.outbound_http import BudgetTransport


def worker(directory, policy, users, start, results):
    async def run():
        events, latencies, errors = [], [], []
        budget = OutboundBudget(directory, BudgetPolicy(**policy))
        class Body(httpx.AsyncByteStream):
            def __init__(self, tenant, download):
                self.tenant, self.download, self.closed = tenant, download, False

            async def __aiter__(self):
                await asyncio.sleep(.04 if self.download else .01)
                yield b'fixture response'

            async def aclose(self):
                if not self.closed:
                    self.closed = True
                    events.append((time.time(), -1, self.tenant))

        async def respond(request):
            tenant = request.headers['cookie']
            events.append((time.time(), 1, tenant))
            download = 'sendfile' in str(request.url)
            return httpx.Response(200, stream=Body(tenant, download),
                                  headers={'Content-Type': 'application/octet-stream' if download else 'text/html'})

        async def user(index):
            before = time.monotonic()
            async with httpx.AsyncClient(transport=BudgetTransport(f'user-{index}', budget=budget,
                inner=httpx.MockTransport(respond)), headers={'Cookie': f'PHPSESSID=synthetic-{index}'}) as client:
                base = settings.ilias_base_url + '/ilias.php?'
                try:
                    await client.get(base + 'baseClass=ilPersonalDesktopGUI')
                    course = base + f'baseClass=ilRepositoryGUI&ref_id={index + 1000}'
                    await asyncio.gather(client.get(course), client.get(course))
                    await client.get(base + f'baseClass=ilexercisehandlergui&cmdClass=ilObjExerciseGUI&cmd=showOverview&ref_id={index + 2000}')
                    files = 9 if index == 0 else 1
                    await asyncio.gather(*[client.get(base + f'baseClass=ilRepositoryGUI&cmd=sendfile&ref_id={index * 100 + file}')
                                           for file in range(files)])
                    latencies.append(time.monotonic() - before)
                except OutboundUnavailable:
                    errors.append('busy')
        await asyncio.to_thread(start.wait)
        await asyncio.gather(*(user(index) for index in users))
        results.put({'events': events, 'latencies': latencies, 'errors': errors})
    asyncio.run(run())


def scenario(users, workers, rate, queue_timeout):
    context = multiprocessing.get_context('spawn')
    with tempfile.TemporaryDirectory(prefix='betterilias-load-') as directory:
        policy = BudgetPolicy(rate=rate, queue_timeout=queue_timeout)
        start, results = context.Event(), context.Queue()
        processes = [context.Process(target=worker,
            args=(directory, asdict(policy), list(range(i, users, workers)), start, results)) for i in range(workers)]
        for process in processes:
            process.start()
        began = time.monotonic()
        start.set()
        try:
            summaries = [results.get(timeout=max(120, users * 8 / rate + 60)) for _ in processes]
        except queue.Empty:
            raise RuntimeError('Load worker failed or timed out') from None
        finally:
            for process in processes:
                process.join(timeout=10)
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=5)
        if any(process.exitcode != 0 for process in processes):
            raise RuntimeError('Load worker exited abnormally')
        elapsed = time.monotonic() - began
        events = sorted(event for summary in summaries for event in summary['events'])
        active, peak, tenant_peak, counts = 0, 0, 0, {}
        for _, change, tenant in events:
            active += change
            counts[tenant] = counts.get(tenant, 0) + change
            peak = max(peak, active)
            tenant_peak = max(tenant_peak, counts[tenant])
        assert active == 0
        assert peak <= policy.concurrency
        assert tenant_peak <= policy.per_session
        latencies = sorted(value for summary in summaries for value in summary['latencies'])
        stats = OutboundBudget(directory, policy).snapshot()
        successful = len(latencies)
        expected = users * 4 + 8
        errors = sum(len(summary['errors']) for summary in summaries)
        if not errors:
            assert stats['requests'] == expected, (stats['requests'], expected)
        return dict(users=users, workers=workers, policy=asdict(policy), elapsed_seconds=round(elapsed, 3),
                    completed=successful, busy=errors, native_requests=stats['requests'],
                    expected_native_requests_without_coalescing=users * 5 + 8,
                    peak_concurrency=peak, peak_per_session=tenant_peak,
                    workflow_p50_seconds=round(statistics.median(latencies), 3) if latencies else None,
                    workflow_p95_seconds=round(latencies[min(len(latencies) - 1, int(len(latencies) * .95))], 3) if latencies else None,
                    queue_wait_seconds=round(stats['queue_wait_seconds'], 3))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--users', nargs='+', type=int, default=[10, 25, 50, 100])
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--rate', type=float, default=50)
    parser.add_argument('--queue-timeout', type=float, default=20)
    args = parser.parse_args()
    if args.workers < 1 or args.rate <= 0 or args.queue_timeout <= 0 or any(count < 1 for count in args.users):
        parser.error('All values must be positive')
    for count in args.users:
        print(json.dumps(scenario(count, args.workers, args.rate, args.queue_timeout)), flush=True)
