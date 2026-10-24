import { describe, expect, it } from 'vitest'
import { basename, dirname, relative, shellQuote, tildify } from '@renderer/lib/paths'

describe('paths', () => {
  it('splits paths', () => {
    expect(basename('/a/b/c.txt')).toBe('c.txt')
    expect(basename('/a/b/')).toBe('b')
    expect(dirname('/a/b/c.txt')).toBe('/a/b')
    expect(relative('/a', '/a/b/c')).toBe('b/c')
    expect(relative('/a', '/a')).toBe('.')
    expect(relative('/a', '/x/y')).toBe('/x/y')
    expect(tildify('/home/me/dev', '/home/me')).toBe('~/dev')
  })

  it('quotes only when needed', () => {
    expect(shellQuote('/plain/path-1.txt')).toBe('/plain/path-1.txt')
    expect(shellQuote('/with space')).toBe("'/with space'")
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})
