import { describe, expect, it } from 'vitest'
import { applyRewriteRules, defaultRewriteRules, parseRewriteRules, rewriteRuleNames, type RewriteTarget } from '../../lib/rules/rewrite'
import { extractContent } from '../../lib/rules/scraper'
import { rewriteUrl } from '../../lib/rules/urlRewrite'
import { toBase64 } from '../../lib/text'

const base: RewriteTarget = { title: 'Title', content: '', url: 'https://example.org/p', commentsUrl: '', guid: 'g', enclosures: [] }
const run = (content: string, rules: string, patch: Partial<RewriteTarget> = {}, options = {}) => applyRewriteRules({ ...base, content, ...patch }, rules, options)

describe('parseRewriteRules', () => {
  it('splits on commas and newlines outside quotes and parentheses', () => {
    expect(parseRewriteRules('nl2br, replace("a,b"|"c\\"d")\nremove(".x, .y"),,')).toEqual([
      { name: 'nl2br', args: '' },
      { name: 'replace', args: '"a,b"|"c\\"d"' },
      { name: 'remove', args: '".x, .y"' },
    ])
  })

  it('lists documented rules', () => {
    expect(rewriteRuleNames).toContain('add_youtube_video')
  })
})

describe('content rules', () => {
  it('returns the input untouched without rules', async () => {
    const target = { ...base, content: '<p>x</p>' }
    expect(await applyRewriteRules(target, '')).toEqual(target)
  })

  it('add_dynamic_image uses lazy loaded sources and noscript images', async () => {
    const result = await run('<img src="blur.jpg" data-src="real.jpg" data-srcset="r 2x"><img data-lazy-srcset="l 1x"><img src="keep.jpg"><figure><img src="small.jpg"><noscript><img src="big.jpg"></noscript></figure><div><noscript>nothing</noscript></div>', 'add_dynamic_image')
    expect(result.content).toContain('src="real.jpg"')
    expect(result.content).toContain('srcset="r 2x"')
    expect(result.content).toContain('srcset="l 1x"')
    expect(result.content).toContain('src="keep.jpg"')
    expect(result.content).toContain('src="big.jpg"')
    expect(result.content).not.toContain('small.jpg')
  })

  it('add_dynamic_iframe uses lazy iframe sources', async () => {
    const result = await run('<iframe data-src="https://player.vimeo.com/1"></iframe><iframe src="https://keep"></iframe>', 'add_dynamic_iframe')
    expect(result.content).toContain('src="https://player.vimeo.com/1"')
    expect(result.content).toContain('src="https://keep"')
  })

  it('add_enclosure_links lists attachments', async () => {
    const result = await run('<p>x</p>', 'add_enclosure_links', { enclosures: [{ url: 'https://e.org/a.mp3', type: 'audio/mpeg', length: 1 }] })
    expect(result.content).toContain('<li><a href="https://e.org/a.mp3">https://e.org/a.mp3</a> (audio/mpeg)</li>')
    expect((await run('<p>x</p>', 'add_enclosure_links')).content).toBe('<p>x</p>')
  })

  it('add_image_title wraps titled images in figures', async () => {
    const result = await run('<img src="a.jpg" title="Caption"><img src="b.jpg" title="">', 'add_image_title')
    expect(result.content).toBe('<figure><img src="a.jpg" title="Caption"><figcaption>Caption</figcaption></figure><img src="b.jpg" title="">')
  })

  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'g', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'g', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/abcdefghijk', 'g', 'abcdefghijk'],
    ['https://example.org/video', 'yt:video:dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('add_youtube_video embeds %s', async (url, guid, id) => {
    const result = await run('<p>d</p>', 'add_youtube_video_from_id', { url, guid })
    expect(result.content).toContain(`src="https://www.youtube-nocookie.com/embed/${id}"`)
  })

  it('does not embed the same video twice or without an id', async () => {
    const twice = await run('', 'add_youtube_video', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    expect(twice.content.match(/<iframe/g)).toHaveLength(1)
    expect((await run('', 'add_youtube_video', { url: 'not a url' })).content).toBe('')
    expect((await run('', 'add_youtube_video', { url: 'https://www.youtube.com/shorts/' })).content).toBe('')
  })

  it('add_youtube_video_using_invidious_player uses the configured instance', async () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    expect((await run('', 'add_youtube_video_using_invidious_player', { url }, { invidiousInstance: 'https://inv.example/' })).content).toContain('src="https://inv.example/embed/dQw4w9WgXcQ"')
    expect((await run('', 'add_youtube_video_using_invidious_player', { url })).content).toContain('https://yewtu.be/embed/dQw4w9WgXcQ')
    expect((await run('', 'add_youtube_video_using_invidious_player', { url: 'https://example.org' })).content).toBe('')
  })

  it('add_invidious_video embeds from the entry host', async () => {
    expect((await run('', 'add_invidious_video', { url: 'https://inv.example/watch?v=abc' })).content).toContain('src="https://inv.example/embed/abc"')
    expect((await run('', 'add_invidious_video', { url: 'https://inv.example/other' })).content).toBe('')
    expect((await run('', 'add_invidious_video', { url: 'bad' })).content).toBe('')
  })

  it('add_castopod_episode embeds the episode player', async () => {
    expect((await run('', 'add_castopod_episode', { url: 'https://pod.example/@show/episodes/1/' })).content).toContain('src="https://pod.example/@show/episodes/1/embed/light"')
    expect((await run('', 'add_castopod_episode', { url: '' })).content).toBe('')
  })

  it('add_mailto_subject shows the subject', async () => {
    const result = await run('<a href="mailto:a@b.c?subject=Hi%20there">Mail</a><a href="mailto:a@b.c">Plain</a><a href="mailto:%">Bad</a>', 'add_mailto_subject')
    expect(result.content).toContain('>Mail [Hi there]</a>')
    expect(result.content).toContain('>Plain</a>')
  })

  it('base64_decode decodes text nodes and leaves other text alone', async () => {
    const encoded = toBase64('<b>secret</b>')
    expect((await run(`<div class="b">${encoded}</div><p>keep me!</p>`, 'base64_decode(".b")')).content).toBe('<div class="b"><b>secret</b></div><p>keep me!</p>')
    expect((await run(`<p>${encoded}</p><p>abcd</p>`, 'base64_decode')).content).toBe('<p><b>secret</b></p><p>abcd</p>')
    expect((await run('<p>!!!</p><p> </p>', 'base64_decode')).content).toBe('<p>!!!</p><p> </p>')
  })

  it('nl2br converts newlines outside pre blocks', async () => {
    expect((await run('<p>a\nb</p><pre>c\nd</pre><p>\n</p>', 'nl2br')).content).toBe('<p>a<br>b</p><pre>c\nd</pre><p>\n</p>')
  })

  it('convert_text_links links bare urls outside anchors and code', async () => {
    const result = await run('<p>see https://a.org/x. and <a href="https://b.org">https://b.org</a> <code>https://c.org</code></p>', 'convert_text_link')
    expect(result.content).toBe('<p>see <a href="https://a.org/x">https://a.org/x</a>. and <a href="https://b.org">https://b.org</a> <code>https://c.org</code></p>')
  })

  it('fix_medium_images and use_noscript_figure_images use noscript images', async () => {
    const html = '<figure><img src="tiny.jpg"><noscript><img src="full.jpg"></noscript></figure><img data-src="lazy.jpg">'
    expect((await run(html, 'fix_medium_images')).content).toBe('<figure><img src="full.jpg"></figure><img data-src="lazy.jpg" src="lazy.jpg">')
    expect((await run(html, 'use_noscript_figure_images')).content).toContain('<figure><img src="full.jpg"></figure>')
  })

  it('replace uses regular expressions on the html', async () => {
    expect((await run('<p>foo foo</p>', 'replace("f(o+)"|"b${1}")')).content).toBe('<p>boo boo</p>')
    expect((await run('<p>foo</p>', 'replace("("|"x")')).content).toBe('<p>foo</p>')
    expect((await run('<p>foo</p>', 'replace("foo")')).content).toBe('<p>foo</p>')
  })

  it('remove deletes elements matching selectors', async () => {
    expect((await run('<p class="ad">x</p><p id="n">y</p><p>z</p>', 'remove(".ad, #n")')).content).toBe('<p>z</p>')
    expect((await run('<p>z</p>', 'remove("[[")')).content).toBe('<p>z</p>')
    expect((await run('<p>z</p>', 'remove')).content).toBe('<p>z</p>')
  })

  it('parse_markdown renders markdown', async () => {
    expect((await run('# Head\n\n*em*', 'parse_markdown')).content).toBe('<h1>Head</h1>\n<p><em>em</em></p>\n')
  })

  it('remove_tables keeps cell content', async () => {
    expect((await run('<table><caption>C</caption><tr><th>H</th><td>D</td></tr></table>', 'remove_tables')).content).toBe('<div>C</div><div>H</div><div>D</div>')
  })

  it('remove_clickbait calms shouting titles', async () => {
    expect((await run('', 'remove_clickbait', { title: 'YOU WON\'T BELIEVE THIS' })).title).toBe("You won't believe this")
    expect((await run('', 'remove_clickbait', { title: 'Wow!!! Really???' })).title).toBe('Wow! Really?')
    expect((await run('', 'remove_clickbait', { title: '123' })).title).toBe('123')
  })

  it('replace_title edits the title', async () => {
    expect((await run('', 'replace_title("^\\[Ad\\] "|"")', { title: '[Ad] Title' })).title).toBe('Title')
    expect((await run('', 'replace_title("["|"")', { title: '[Ad]' })).title).toBe('[Ad]')
  })

  it('add_hn_links rewrites comment links to app urls', async () => {
    const commentsUrl = 'https://news.ycombinator.com/item?id=42'
    const hack = await run('<a href="https://news.ycombinator.com/item?id=42">c</a>', 'add_hn_links_using_hack', { commentsUrl })
    expect(hack.content).toBe('<a href="hack://item?id=42">c</a>')
    const opener = await run('<p>x</p>', 'add_hn_links_using_opener', { commentsUrl })
    expect(opener.content).toContain('opener://x-callback-url/show-options?url=https%3A%2F%2Fnews.ycombinator.com%2Fitem%3Fid%3D42')
    expect((await run('<p>x</p>', 'add_hn_links_using_hack')).content).toBe('<p>x</p>')
  })

  it('fix_ghost_cards turns bookmark cards into links', async () => {
    const html = '<figure class="kg-card kg-bookmark-card"><a class="kg-bookmark-container" href="https://g.org"><div class="kg-bookmark-title">Ghost</div></a></figure><figure class="kg-bookmark-card"><a href="https://h.org"></a></figure><figure class="kg-bookmark-card"></figure>'
    expect((await run(html, 'fix_ghost_cards')).content).toBe('<a href="https://g.org">Ghost</a><a href="https://h.org">https://h.org</a><figure class="kg-bookmark-card"></figure>')
  })

  it('remove_img_blur_params strips blur parameters', async () => {
    const result = await run('<img src="https://i.org/a.jpg?blur=50&w=1"><img src="https://i.org/b.jpg?w=1"><img src="relative.jpg">', 'remove_img_blur_params')
    expect(result.content).toBe('<img src="https://i.org/a.jpg?w=1"><img src="https://i.org/b.jpg?w=1"><img src="relative.jpg">')
  })

  it('ignores unknown rules', async () => {
    expect((await run('<p>x</p>', 'does_not_exist')).content).toBe('<p>x</p>')
  })
})

describe('default rules', () => {
  it('picks rules per site', () => {
    expect(defaultRewriteRules('https://www.youtube.com/watch?v=x')).toBe('add_youtube_video')
    expect(defaultRewriteRules('https://youtu.be/x')).toBe('add_youtube_video')
    expect(defaultRewriteRules('https://m.youtube.com/watch?v=x')).toBe('add_youtube_video')
    expect(defaultRewriteRules('https://medium.com/p')).toBe('fix_medium_images')
    expect(defaultRewriteRules('https://example.org')).toBe('')
  })
})

describe('rewriteUrl', () => {
  it('rewrites matching urls', () => {
    expect(rewriteUrl('https://www.npr.org/2026/01/02/12345/story', 'rewrite("^https:\\/\\/www\\.npr\\.org\\/\\d{4}\\/\\d{2}\\/\\d{2}\\/(\\d+)\\/.*$"|"https://text.npr.org/$1")')).toBe('https://text.npr.org/12345')
    expect(rewriteUrl('https://x.org/a.html', ' rewrite("(.*?\\.html)"|"$1?seite=all") ')).toBe('https://x.org/a.html?seite=all')
  })

  it('leaves urls alone for empty, invalid or non matching rules', () => {
    expect(rewriteUrl('https://x.org', '')).toBe('https://x.org')
    expect(rewriteUrl('https://x.org', 'something("a"|"b")')).toBe('https://x.org')
    expect(rewriteUrl('https://x.org', 'rewrite("a")')).toBe('https://x.org')
    expect(rewriteUrl('https://x.org', 'rewrite("("|"b")')).toBe('https://x.org')
    expect(rewriteUrl('https://x.org', 'rewrite("nomatch"|"b")')).toBe('https://x.org')
  })
})

describe('extractContent', () => {
  it('extracts matching elements and absolutizes urls', async () => {
    const html = '<html><head><base href="/base/"></head><body><nav>menu</nav><div id="article"><p>Body <img src="i.png" srcset="a.png 1x, /b.png 2x"><a href="../l">l</a></p></div></body></html>'
    const content = await extractContent(html, 'https://site.org/post', 'div#article')
    expect(content).toBe('<div id="article"><p>Body <img src="https://site.org/base/i.png" srcset="https://site.org/base/a.png 1x, https://site.org/b.png 2x"><a href="https://site.org/l">l</a></p></div>')
  })

  it('falls back to readability when selectors match nothing or are invalid', async () => {
    const paragraph = '<p>' + 'Readable sentence with enough words to count as content. '.repeat(20) + '</p>'
    const html = `<html><body><nav>menu</nav><article><h1>T</h1>${paragraph}${paragraph}</article><footer>foot</footer></body></html>`
    for (const rules of ['.missing', '[[', '']) {
      const content = await extractContent(html, 'https://site.org/post', rules)
      expect(content).toContain('Readable sentence')
      expect(content).not.toContain('menu')
    }
  })

  it('returns an empty string when nothing is readable', async () => {
    expect(await extractContent('<html><body></body></html>', 'https://site.org/', '')).toBe('')
  })
})
