"""Prepare an offline review packet, report findings, or score frozen Stage D results."""

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from evaluation.report import build_report, digest_bytes, find_record, prepare_view, render_markdown
from evaluation.scoring import score_execution


def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare')
    prepare.add_argument('--cases', type=Path, required=True)
    prepare.add_argument('--case', required=True)
    prepare.add_argument('--view', required=True)
    prepare.add_argument('--output', type=Path, required=True)
    report = commands.add_parser('report')
    report.add_argument('--cases', type=Path, required=True)
    report.add_argument('--references', type=Path, required=True)
    report.add_argument('--findings', type=Path, required=True)
    report.add_argument('--source-root', type=Path, required=True)
    report.add_argument('--output-dir', type=Path, required=True, help='New directory for both reports')
    score = commands.add_parser('score', help='Score the frozen, paired Stage D review')
    score.add_argument('--execution', type=Path, required=True)
    args = parser.parse_args()

    try:
        if args.command == 'score':
            print(json_text(score_execution(args.execution)), end='')
            return
        raw_cases = args.cases.read_bytes()
        cases = json.loads(raw_cases)
        cases_sha256 = digest_bytes(raw_cases)
        if args.command == 'prepare':
            case = find_record(cases['cases'], 'case_id', args.case)
            packet = prepare_view(case, args.view)
            packet.update(set_id=cases['set_id'], cases_sha256=cases_sha256)
            with args.output.open('x', encoding='utf-8') as stream:
                stream.write(json_text(packet))
        else:
            raw_refs = args.references.read_bytes()
            findings = json.loads(args.findings.read_bytes())
            result = build_report(
                cases, json.loads(raw_refs), findings, args.source_root,
                {'cases': cases_sha256, 'references': digest_bytes(raw_refs)},
            )
            if args.output_dir.exists():
                raise FileExistsError(f'Report directory already exists: {args.output_dir}')
            output = args.output_dir.resolve()
            with TemporaryDirectory(prefix='.evaluation-', dir=output.parent) as temporary:
                staged = Path(temporary) / 'report'
                staged.mkdir()
                (staged / 'evaluation.json').write_text(json_text(result), encoding='utf-8')
                (staged / 'evaluation.md').write_text(render_markdown(result), encoding='utf-8')
                staged.rename(output)
    except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
        parser.exit(2, f'Evaluation input error: {error}\n')


if __name__ == '__main__':
    main()
