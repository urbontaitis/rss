export function compileRegex(source: string, extraFlags = ''): RegExp | null {
  let pattern = source
  let flags = extraFlags
  const inline = /^\(\?([imsU]+)\)/.exec(pattern)
  if (inline) {
    pattern = pattern.slice(inline[0].length)
    for (const flag of inline[1]) if (flag !== 'U' && !flags.includes(flag)) flags += flag
  }
  pattern = pattern.replace(/\\z/g, '$').replace(/\\A/g, '^').replace(/\(\?P</g, '(?<')
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

export function goReplacement(value: string): string {
  return value.replace(/\$\{(\d+)\}/g, '$$$1')
}

export function splitQuotedArgs(value: string): string[] {
  const args: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(value))) args.push(match[1].replace(/\\"/g, '"'))
  return args
}
