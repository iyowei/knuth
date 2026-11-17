import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfigFile } from './config.ts';
import {
  renderDockerCompose,
  renderDockerRunCommand,
  renderVerdaccioConfig,
} from './renderers.ts';

interface CliOptions {
  configPath?: string;
  useExample: boolean;
  dryRun: boolean;
  check: boolean;
  help: boolean;
}

const DEFAULT_CONFIG_FILENAME = 'knuth.config.json';
const EXAMPLE_CONFIG_FILENAME = 'knuth.config.example.json';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    useExample: false,
    dryRun: false,
    check: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--example') {
      options.useExample = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--config' || arg === '-c') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        throw new Error(`参数 ${arg} 缺少配置文件路径`);
      }
      options.configPath = next;
      i += 1;
    } else if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length);
      if (!value) {
        throw new Error('参数 --config= 缺少配置文件路径');
      }
      options.configPath = value;
    } else {
      throw new Error(`未知参数: ${arg} (使用 --help 查看帮助)`);
    }
  }

  return options;
}

function resolveSourceConfigPath(cwd: string, options: CliOptions): string {
  if (options.configPath) {
    const explicitPath = resolve(cwd, options.configPath);
    if (!existsSync(explicitPath)) {
      throw new Error(`未找到指定的配置文件: ${explicitPath}`);
    }
    return explicitPath;
  }

  if (options.useExample) {
    const examplePath = resolve(cwd, EXAMPLE_CONFIG_FILENAME);
    if (!existsSync(examplePath)) {
      throw new Error(`未找到示例配置文件: ${examplePath}`);
    }
    return examplePath;
  }

  const localPath = resolve(cwd, DEFAULT_CONFIG_FILENAME);
  if (existsSync(localPath)) {
    return localPath;
  }

  throw new Error(
    [
      `未找到本地配置文件 "${DEFAULT_CONFIG_FILENAME}".`,
      `请先复制示例配置并按需修改:`,
      `  cp ${EXAMPLE_CONFIG_FILENAME} ${DEFAULT_CONFIG_FILENAME}`,
      `或直接用示例配置快速体验:`,
      `  npm run init -- --example`,
    ].join('\n'),
  );
}

function printHelp(): void {
  console.log(`Knuth 初始化生成器

用法:
  npm run init [选项]

选项:
  -c, --config <路径>  指定自定义 JSON 配置文件 (默认读取 ./${DEFAULT_CONFIG_FILENAME})
  --example            使用内置示例配置 (${EXAMPLE_CONFIG_FILENAME}) 进行初始化
  --dry-run            仅预览将要生成的文件摘要, 不写入磁盘
  --check              检查已生成文件是否与配置源一致 (防配置漂移)
  -h, --help           显示本帮助信息`);
}

/**
 * 执行 Knuth 初始化生成逻辑, 返回进程退出码.
 */
export function runCli(argv: string[], cwd = process.cwd()): number {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const sourcePath = resolveSourceConfigPath(cwd, options);
  const config = loadConfigFile(sourcePath);

  const outputs = [
    { relPath: 'conf/config.yaml', content: renderVerdaccioConfig(config) },
    { relPath: 'docker-compose.yaml', content: renderDockerCompose(config, false) },
    { relPath: 'docker-compose-debug.yaml', content: renderDockerCompose(config, true) },
  ];

  if (options.check) {
    const drifted: string[] = [];
    for (const item of outputs) {
      const targetPath = resolve(cwd, item.relPath);
      if (!existsSync(targetPath)) {
        drifted.push(`${item.relPath} (缺失)`);
        continue;
      }
      const actual = readFileSync(targetPath, 'utf8');
      if (actual !== item.content) {
        drifted.push(`${item.relPath} (内容与配置源不一致)`);
      }
    }
    if (drifted.length > 0) {
      console.error(`校验失败, 以下生成产物需要重新执行初始化:\n  - ${drifted.join('\n  - ')}`);
      return 1;
    }
    console.log(`校验通过: 生成产物与配置源 (${sourcePath}) 完全一致.`);
    return 0;
  }

  if (options.dryRun) {
    console.log(`[dry-run] 配置源: ${sourcePath}`);
    for (const item of outputs) {
      console.log(`  - 将生成 ${item.relPath} (${Buffer.byteLength(item.content, 'utf8')} 字节)`);
    }
    console.log('\n等效 docker run 命令:\n' + renderDockerRunCommand(config));
    return 0;
  }

  for (const item of outputs) {
    const targetPath = resolve(cwd, item.relPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, item.content, 'utf8');
  }

  console.log(`已基于 ${sourcePath} 生成以下运行文件:`);
  for (const item of outputs) {
    console.log(`  - ${item.relPath}`);
  }
  console.log('\n可用以下方式启动:');
  console.log('  docker compose up -d');
  console.log('  docker compose -f ./docker-compose-debug.yaml up');
  console.log('\n或直接使用社区镜像运行:\n' + renderDockerRunCommand(config));
  return 0;
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntrypoint) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`初始化失败: ${message}`);
    process.exitCode = 1;
  }
}
