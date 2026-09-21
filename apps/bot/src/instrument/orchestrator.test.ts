import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTarget, toAppName } from './orchestrator.js';

describe('instrument target parsing', () => {
  it('accepts a GitHub URL with or without .git and a trailing slash', () => {
    for (const url of ['https://github.com/codewithdoni/demo_app', 'https://github.com/codewithdoni/demo_app.git', 'https://github.com/codewithdoni/demo_app/']) {
      const target = parseTarget(url);
      assert.equal(target.cloneFrom, 'https://github.com/codewithdoni/demo_app.git');
      assert.equal(target.name, 'demo_app');
      assert.equal(target.isGithub, true);
    }
  });

  it('refuses anything that is not a GitHub URL', () => {
    // Local paths need an explicit opt-in; everything else is rejected outright,
    // because this input reaches `git clone` and a headless coding agent.
    for (const bad of ['git@github.com:owner/repo.git', 'https://evil.example.com/repo', '/tmp/repo', 'file:///tmp/repo', '--upload-pack=touch /tmp/pwned', '']) {
      assert.throws(() => parseTarget(bad), /GitHub URL/, `accepted ${bad}`);
    }
  });

  it('turns a repository name into a safe catalog name', () => {
    assert.equal(toAppName('My-Cool.App'), 'my_cool_app');
    assert.equal(toAppName('123app'), 'app_123app');
    assert.equal(toAppName('a'.repeat(80)).length, 48);
  });
});
