import { describe, it, expect } from 'vitest'
import { buildCsp } from './csp'

describe('buildCsp', () => {
  it('whitelists the backend origin in connect-src', () => {
    const csp = buildCsp('http://localhost:8080')
    expect(csp).toContain("connect-src 'self' http://localhost:8080")
  })

  it('uses only the origin, dropping any path/query', () => {
    const csp = buildCsp('https://pos.example.com:9443/api/')
    expect(csp).toContain("connect-src 'self' https://pos.example.com:9443")
    expect(csp).not.toContain('/api')
  })

  it('falls back to self-only when the URL is unparseable', () => {
    const csp = buildCsp('not a url')
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain('not a url')
  })

  it('keeps the base directives', () => {
    const csp = buildCsp('http://localhost:8080')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("img-src 'self' data:")
  })
})
