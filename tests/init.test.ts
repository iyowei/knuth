import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { loadConfigFile, normalizeScopePattern, validateConfig } from '../scripts/config.ts';
import { runCli } from '../scripts/init.ts';
import { renderDockerCompose, renderVerdaccioConfig } from '../scripts/renderers.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');

test('示例配置 knuth.config.example.ts 校验并渲染完整安全规则', async () => {
  const config = await loadConfigFile(join(REPO_ROOT, 'knuth.config.example.ts'));
  const yaml = renderVerdaccioConfig(config);

  assert.match(yaml, /^# Knuth NPM 注册表 — /);
  assert.doesNotMatch(yaml, /^\s*logo:/m, '默认空 logo 时不应生成 logo 字段');
  assert.match(yaml, /publicPath: "http:\/\/localhost:5673"/);

  const privateIdx = yaml.indexOf('"@knuth/*":');
  const publicInternalIdx = yaml.indexOf('"@knuth-public/*":');
  const wildcardIdx = yaml.indexOf('"@*/*":');
  assert.ok(privateIdx !== -1 && publicInternalIdx !== -1 && wildcardIdx !== -1);
  assert.ok(privateIdx < wildcardIdx, '私有 scope 必须排在 "@*/*" 之前');
  assert.ok(publicInternalIdx < wildcardIdx, '公开内部 scope 必须排在 "@*/*" 之前');

  // 私有与公开内部 scope 段禁止存在 proxy, 切断依赖混淆路径
  const privateSection = yaml.slice(privateIdx, publicInternalIdx);
  const publicInternalSection = yaml.slice(publicInternalIdx, wildcardIdx);
  assert.doesNotMatch(privateSection, /^\s*proxy:/m);
  assert.doesNotMatch(publicInternalSection, /^\s*proxy:/m);

  const prodCompose = renderDockerCompose(config, false);
  const debugCompose = renderDockerCompose(config, true);
  assert.match(prodCompose, /VERDACCIO_PUBLIC_URL: "http:\/\/localhost:5673"/);
  assert.doesNotMatch(debugCompose, /VERDACCIO_PUBLIC_URL/);
});

test('scope 规范化支持简写并拦截危险通配规则', () => {
  assert.equal(normalizeScopePattern('acme', 'test'), '@acme/*');
  assert.equal(normalizeScopePattern('@acme', 'test'), '@acme/*');
  assert.equal(normalizeScopePattern('@acme/*', 'test'), '@acme/*');

  assert.throws(() => normalizeScopePattern('@*/*', 'test'));
  assert.throws(() => normalizeScopePattern('**', 'test'));
  assert.throws(() => normalizeScopePattern('@BadUpper/*', 'test'));
  assert.throws(() => normalizeScopePattern('@acme/*\ninject', 'test'));
});

test('字段校验拦截越界端口、YAML 注入、重名上游与交叉冲突 scope', () => {
  const base = {
    registry: {
      title: 'My: "Secure" #Registry',
      publicUrl: 'https://npm.myteam.dev///',
      logo: 'https://cdn.myteam.dev/logo.png',
    },
    scopes: {
      private: ['myteam'],
      publicInternal: ['@myteam-open/*'],
    },
  };

  const normalized = validateConfig(base);
  assert.equal(normalized.registry.publicUrl, 'https://npm.myteam.dev');
  assert.deepEqual(normalized.scopes.private, ['@myteam/*']);
  const yaml = renderVerdaccioConfig(normalized);
  assert.match(yaml, /title: "My: \\"Secure\\" #Registry"/);
  assert.match(yaml, /logo: "https:\/\/cdn\.myteam\.dev\/logo\.png"/);

  assert.throws(
    () =>
      validateConfig({
        registry: { title: 'Test', publicUrl: 'ftp://invalid.local' },
      }),
    /http 或 https/,
  );

  assert.throws(
    () =>
      validateConfig({
        registry: { title: 'Test\nevil: true', publicUrl: 'https://a.dev' },
      }),
    /换行或控制字符/,
  );

  assert.throws(
    () =>
      validateConfig({
        registry: { title: 'Test', publicUrl: 'https://a.dev' },
        docker: { port: 70000 },
      }),
    /范围内的整数/,
  );

  assert.throws(
    () =>
      validateConfig({
        registry: { title: 'Test', publicUrl: 'https://a.dev' },
        scopes: { private: ['@dup/*'], publicInternal: ['dup'] },
      }),
    /不能同时出现/,
  );

  assert.throws(
    () =>
      validateConfig({
        registry: { title: 'Test', publicUrl: 'https://a.dev' },
        uplinks: [],
      }),
    /非空数组/,
  );
});

test('loadConfigFile 校验模块默认导出与格式白名单', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'knuth-load-test-'));
  try {
    const noDefaultPath = join(workDir, 'bad.ts');
    writeFileSync(noDefaultPath, 'export const foo = 1;\n', 'utf8');
    await assert.rejects(() => loadConfigFile(noDefaultPath), /缺少默认导出/);

    const badExtPath = join(workDir, 'bad.yaml');
    writeFileSync(badExtPath, 'foo: bar\n', 'utf8');
    await assert.rejects(() => loadConfigFile(badExtPath), /不支持的配置文件格式/);

    const jsonPath = join(workDir, 'custom.json');
    writeFileSync(
      jsonPath,
      JSON.stringify({ registry: { title: 'JSON Fallback', publicUrl: 'https://a.dev' } }),
      'utf8',
    );
    const loadedJson = await loadConfigFile(jsonPath);
    assert.equal(loadedJson.registry.title, 'JSON Fallback');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('runCli 读取 knuth.config.ts 端到端生成、dry-run 与漂移校验 (--check)', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'knuth-cli-test-'));
  try {
    const configHelperUrl = new URL('../scripts/config.ts', import.meta.url).href;
    writeFileSync(
      join(workDir, 'knuth.config.ts'),
      `import { defineConfig } from ${JSON.stringify(configHelperUrl)};

export default defineConfig({
  registry: {
    title: 'Team Registry',
    description: '团队私有 npm 仓库',
    publicUrl: 'https://registry.team.internal',
  },
  docker: {
    port: 4873,
    containerName: 'team-verdaccio',
  },
  scopes: {
    private: ['@team/*'],
  },
});
`,
      'utf8',
    );

    // dry-run 不写入文件
    assert.equal(await runCli(['--dry-run'], workDir), 0);
    assert.equal(existsSync(join(workDir, 'conf/config.yaml')), false);

    // 正常初始化落盘
    assert.equal(await runCli([], workDir), 0);
    const generatedYaml = readFileSync(join(workDir, 'conf/config.yaml'), 'utf8');
    const generatedCompose = readFileSync(join(workDir, 'docker-compose.yaml'), 'utf8');
    assert.match(generatedYaml, /"@team\/\*":/);
    assert.match(generatedCompose, /4873:4873/);
    assert.match(generatedCompose, /team-verdaccio/);

    // 一致性校验通过
    assert.equal(await runCli(['--check'], workDir), 0);

    // 人为篡改产物后 --check 应报错返回 1
    mkdirSync(join(workDir, 'conf'), { recursive: true });
    writeFileSync(join(workDir, 'conf/config.yaml'), `${generatedYaml}\n# tampered\n`, 'utf8');
    assert.equal(await runCli(['--check'], workDir), 1);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
