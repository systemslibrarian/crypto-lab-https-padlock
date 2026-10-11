import { spawnSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const childEnvironment = { ...process.env, NODE_OPTIONS: '' }

describe('X.509 entry points in a fresh process', () => {
  it('initializes the application parser before loading the SDK, without a test setup polyfill', () => {
    const parser = new URL('./parse.ts', import.meta.url).href
    const certificate = fileURLToPath(new URL('../../certs/real-github-leaf.pem', import.meta.url))
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', `
      import assert from 'node:assert/strict'
      import { readFileSync } from 'node:fs'
      assert.equal(typeof Reflect.getMetadata, 'undefined')
      const { parsePem, commonName, fingerprint } = await import(${JSON.stringify(parser)})
      const cert = parsePem(readFileSync(${JSON.stringify(certificate)}, 'utf8'))
      assert.equal(commonName(cert), 'github.com')
      assert.equal(await fingerprint(cert), '46b601ee08b418cf8a3a1ebfe670ba5ce43bb05a917fa8b2dd087a30471cfc63')
      console.log('cold parser and certificate KAT passed')
    `], { cwd: root, env: childEnvironment, encoding: 'utf8', timeout: 30_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('cold parser and certificate KAT passed')
  })

  it('initializes the standalone minter and verifies all signatures in isolated scratch', () => {
    // The real script rotates the toy keys. Copy it into owned scratch so this
    // regression never replaces the vendored certificates or their KATs.
    const scratch = mkdtempSync(join(tmpdir(), 'padlock-minter-bootstrap-'))
    try {
      mkdirSync(join(scratch, 'scripts'))
      mkdirSync(join(scratch, 'certs'))
      copyFileSync(join(root, 'scripts/mint-toy-pki.mjs'), join(scratch, 'scripts/mint-toy-pki.mjs'))
      symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'))
      const result = spawnSync(process.execPath, ['scripts/mint-toy-pki.mjs'], {
        cwd: scratch, env: childEnvironment, encoding: 'utf8', timeout: 30_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.match(/\bverified\b/g)).toHaveLength(4)
      expect(readdirSync(join(scratch, 'certs')).sort()).toEqual([
        'toy-attacker-leaf.pem', 'toy-dv-ca.pem', 'toy-root.pem', 'toy-selfsigned-leaf.pem',
      ])
      const cert = (name: string) => new X509Certificate(readFileSync(join(scratch, 'certs', name)))
      const rootCert = cert('toy-root.pem')
      const dv = cert('toy-dv-ca.pem')
      const attacker = cert('toy-attacker-leaf.pem')
      const selfSigned = cert('toy-selfsigned-leaf.pem')
      expect(dv.verify(rootCert.publicKey)).toBe(true)
      expect(attacker.verify(dv.publicKey)).toBe(true)
      expect(rootCert.verify(rootCert.publicKey)).toBe(true)
      expect(selfSigned.verify(selfSigned.publicKey)).toBe(true)
      expect(attacker.subjectAltName).toBe('DNS:login.yourbank-security.example')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
