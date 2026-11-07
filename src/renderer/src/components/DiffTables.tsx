import { Fragment, useMemo } from 'react'
import { splitRows, type DiffLine } from '../lib/diff'

/** Diff lines side by side or in one column, as the Diff tab and the review cockpit show them. */
export function DiffLines({ lines, layout, open }: { lines: DiffLine[]; layout: 'split' | 'unified'; open?: (line: number) => void }): React.JSX.Element {
  if (layout === 'split') return <SplitTable lines={lines} open={open} />
  return (
    <table className="diff-table">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className={l.kind}>
            <td className="ln">{l.oldNo ?? ''}</td>
            <td className="ln" onDoubleClick={() => l.newNo && open?.(l.newNo)}>{l.newNo ?? ''}</td>
            <td className="sign">{sign(l)}</td>
            <td className="code">{l.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SplitTable({ lines, open }: { lines: DiffLine[]; open?: (line: number) => void }): React.JSX.Element {
  const rows = useMemo(() => splitRows(lines), [lines])
  return (
    <table className="diff-table split">
      <colgroup>
        <col className="ln-col" />
        <col className="sign-col" />
        <col />
        <col className="ln-col" />
        <col className="sign-col" />
        <col />
      </colgroup>
      <tbody>
        {rows.map((r, i) =>
          r.kind === 'pair' ? (
            <tr key={i}>
              <Side line={r.left} no={r.left?.oldNo} />
              <Side line={r.right} no={r.right?.newNo} open={open} />
            </tr>
          ) : (
            <tr key={i} className={r.kind}>
              <td colSpan={6} className="code">{r.text}</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  )
}

function Side({ line, no, open }: { line?: DiffLine; no?: number; open?: (line: number) => void }): React.JSX.Element {
  const kind = line?.kind ?? 'blank'
  return (
    <Fragment>
      <td className={`ln ${kind}`} onDoubleClick={() => no && open?.(no)}>{no ?? ''}</td>
      <td className={`sign ${kind}`}>{line ? sign(line) : ''}</td>
      <td className={`code ${kind}`}>{line?.text ?? ''}</td>
    </Fragment>
  )
}

const sign = (l: DiffLine): string => (l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : '')
