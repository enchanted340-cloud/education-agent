import http.client
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path

from webapp.server import make_server


REPO = Path(__file__).resolve().parents[1]
ARCHIVE = Path('experiments/stage-d-20261118/execution')
SOURCE = REPO.parent / ARCHIVE


class EvaluationEndpointTests(unittest.TestCase):
    def get(self, root, path='/api/evaluation', headers=None):
        with make_server(root, 0) as server:
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                conn.request('GET', path, headers=headers or {})
                response = conn.getresponse()
                return response.status, json.loads(response.read())
            finally:
                conn.close()
                server.shutdown()
                worker.join()

    def test_missing_archive_returns_empty_state_and_enforces_host(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'project'
            self.assertEqual(self.get(root), (200, {'available': False}))
            self.assertEqual(self.get(root, headers={'Host': 'example.test'})[0], 403)

    @unittest.skipUnless(SOURCE.is_dir(), 'Stage D archive is not installed')
    def test_real_archived_result_and_case_versions(self):
        status, data = self.get(REPO)
        self.assertEqual(status, 200)
        self.assertEqual(set(data), {'available', 'taskCount', 'armCount', 'total', 'paired',
                                    'metrics', 'skills', 'cases', 'improvedTaskCount'})
        self.assertIs(data['available'], True)
        self.assertEqual((data['taskCount'], data['armCount'], data['total'], data['paired']),
                         (8, 3, 24, 21))
        main = data['metrics']['primary_score']
        self.assertEqual((main['before_passed'], main['after_passed']), (13, 17))
        self.assertEqual(data['improvedTaskCount'], 2)
        self.assertAlmostEqual(main['change_pp'], 19.047619)
        self.assertEqual([(s['key'], s['included'], s['primary']['change_pp']) for s in data['skills']],
                         [('B-A', 8, 0), ('C-A', 7, 0)])
        self.assertEqual([(s['final']['included'], s['final']['primary']['before_passed'],
                           s['final']['primary']['after_passed']) for s in data['skills']],
                         [(6, 5, 4), (5, 4, 4)])
        self.assertEqual([s['draftCounts'] for s in data['skills']],
                         [{'improved': 1, 'regressed': 1, 'tied': 6},
                          {'improved': 0, 'regressed': 0, 'tied': 7}])
        cases = data['cases']
        self.assertEqual([(case['task'], case['arm']) for case in cases],
                         [('H08', 'A'), ('H03', 'A'), ('H01', 'A'), ('H06', 'B')])
        self.assertEqual(cases[0]['versions'][0]['sample']['input'], '1 10\n6')
        self.assertIn('最优仍为 6', cases[0]['versions'][0]['findings'][0])
        self.assertEqual([(v['sample']['input'], v['sample']['output'], v['expected'])
                          for v in cases[1]['versions']],
                         [('5\n2 -1 0 -1 2', '2', '1'), ('4\n-1 2 -1 0', '2', '2')])
        repair = cases[2]['versions'][1]
        self.assertIn('复审缺测', repair['status'])
        self.assertEqual((repair['sample']['output'], repair['expected']), ('50000 1', '50000 1'))
        self.assertEqual(repair['scores']['primary_score'], 0)
        self.assertEqual(repair['scores']['sample_accuracy_score'], 100)
        self.assertAlmostEqual(repair['scores']['coverage_score'], 200 / 3)
        self.assertIn('没有奇数行起点', repair['findings'][0])
        self.assertIn('参考解析选用', cases[3]['requirement'])
        self.assertIn('要求使用贪心策略', cases[3]['versions'][0]['statement'])
        for case in cases:
            self.assertEqual(set(case), {'task', 'arm', 'title', 'subtitle', 'requirement', 'versions'})
            for version in case['versions']:
                self.assertEqual(set(version), {'version', 'status', 'statement', 'sample',
                                                'expected', 'findings', 'scores'})
                self.assertEqual(set(version['sample']), {'input', 'output', 'explanation'})
        self.assertNotIn('fixture:stage-d', json.dumps(data))

    @unittest.skipUnless(SOURCE.is_dir(), 'Stage D archive is not installed')
    def test_rejects_changed_source_and_corrupted_frozen_data(self):
        def rewrite_primary(data):
            primary = data['comparisons']['all']['draft_to_final']['metrics']['primary_score']
            primary.update(before_passed=12, before_mean=1200 / 21, change_pp=500 / 21,
                           relative_pct=500 / 12)

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'project'
            execution = root.parent / ARCHIVE
            shutil.copytree(SOURCE, execution, ignore=shutil.ignore_patterns('cache', '*.sqlite3'))
            for relative, change in (
                ('cases/H03/A/generation.json', lambda d: d['versions'].reverse()),
                ('blind-review/sample-recomputation.json', lambda d: d['Q27']['samples'].reverse()),
                ('cases/H03/A/request.json', lambda d: d['requirements'].append('unbound')),
                ('score-report.json', lambda d: d['rows']['H03']['A'].update(draft=None)),
                ('score-report.json', rewrite_primary),
            ):
                path = execution / relative
                raw = path.read_bytes()
                with self.subTest(path=relative):
                    data = json.loads(raw)
                    change(data)
                    path.write_text(json.dumps(data), encoding='utf-8')
                    self.assertEqual(self.get(root), (500, {'error': '实验归档读取失败'}))
                path.write_bytes(raw)

    def test_incomplete_archive_is_a_read_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'project'
            (root.parent / ARCHIVE).mkdir(parents=True)
            self.assertEqual(self.get(root), (500, {'error': '实验归档读取失败'}))
