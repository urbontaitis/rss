const groups: [string, [string, string][]][] = [
  ['Global', [['/', 'Focus search'], ['R', 'Refresh all feeds'], ['?', 'Show keyboard shortcuts']]],
  ['Entry list', [['j / ↓', 'Next item'], ['k / ↑', 'Previous item'], ['o / Enter', 'Open selected entry'], ['v', 'Open original link'], ['m', 'Toggle read'], ['s', 'Toggle star'], ['A', 'Mark page as read'], ['n / p', 'Next / previous page']]],
  ['Entry', [['j / n / →', 'Next entry'], ['k / p / ←', 'Previous entry'], ['u / Backspace', 'Back to list'], ['v', 'Open original link'], ['m', 'Toggle read'], ['s', 'Toggle star'], ['d', 'Fetch original content']]],
]

export function ShortcutsPage() {
  return (
    <section>
      <div className="page-header"><h1>Keyboard shortcuts</h1></div>
      {groups.map(([title, keys]) => (
        <div key={title} className="panel">
          <h2>{title}</h2>
          <dl className="shortcuts">
            {keys.map(([key, label]) => (
              <div key={key}>
                <dt><kbd>{key}</kbd></dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  )
}
