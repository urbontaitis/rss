import { filterFields } from '../lib/rules/filter'
import { rewriteRuleNames } from '../lib/rules/rewrite'

export function FilterRulesHelp() {
  return (
    <details className="help">
      <summary>Filter rule syntax</summary>
      <p>One rule per line, written as <code>FieldName=RegEx</code>. Processing stops at the first match. Order: global block, feed block, global keep, feed keep.</p>
      <p>Fields: {filterFields.map((field) => <code key={field}>{field}</code>).reduce<React.ReactNode[]>((all, item, index) => (index ? [...all, ', ', item] : [item]), [])}.</p>
      <p><code>EntryDate</code> accepts <code>future</code>, <code>before:YYYY-MM-DD</code>, <code>after:YYYY-MM-DD</code>, <code>between:YYYY-MM-DD,YYYY-MM-DD</code> and <code>max-age:7d</code> (units: ns, us, ms, s, m, h, d).</p>
      <p>A line without a field name is matched against title, URL, author and tags.</p>
      <pre>{`EntryTitle=(?i)sponsored
EntryTag=^Podcast$
EntryDate=max-age:30d`}</pre>
    </details>
  )
}

export function RewriteRulesHelp() {
  return (
    <details className="help">
      <summary>Rewrite rule syntax</summary>
      <p>Comma separated list of rules, applied to new entries.</p>
      <p>{rewriteRuleNames.map((name) => <code key={name}>{name}</code>).reduce<React.ReactNode[]>((all, item, index) => (index ? [...all, ' ', item] : [item]), [])}</p>
      <pre>{`add_image_title,remove(".ad, #newsletter"),replace("foo"|"bar"),replace_title("^\\[Ad\\] "|"")`}</pre>
      <p>YouTube entries get <code>add_youtube_video</code> automatically.</p>
    </details>
  )
}

export function ScraperRulesHelp() {
  return (
    <details className="help">
      <summary>Scraper and URL rewrite rule syntax</summary>
      <p>Scraper rules are CSS selectors used to extract content from the original page, e.g. <code>article, div.content</code>. Without a rule the readability algorithm is used.</p>
      <p>URL rewrite rules change the address used to fetch the original page: <code>{`rewrite("(.*?\\.html)"|"$1?page=all")`}</code></p>
    </details>
  )
}
