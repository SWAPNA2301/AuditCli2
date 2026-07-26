#!/usr/bin/env node
const path = require('path');
// Load .env from the project's own folder, not the caller's current
// directory. `auditcli` is meant to run from anywhere (that's the point of
// `npm link`) — dotenv's default `.env` lookup only checks process.cwd(),
// so running it from any other folder silently found nothing and every
// integration reported "env vars missing" even with a fully configured .env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const Table = require('cli-table3');
const boxen = require('boxen');
const figlet = require('figlet');

const { runAudit } = require('./lib/auditor');
const { jiraConfigFromEnv, fileIssuesToJira } = require('./lib/jira');
const { slackConfigFromEnv, postSummaryToSlack } = require('./lib/slack');
const { saveReport, listReports, safeHostName } = require('./lib/report');
const { generateAiSummary, aiConfigFromEnv } = require('./lib/ai');
const { discoverCompetitors } = require('./lib/competitors');
const { peerRelativeStats } = require('./lib/riskScore');
const { startDashboard } = require('./lib/webServer');

const STEP_LABELS = {
  crawling: 'Crawling site & discovering pages/assets',
  'broken-links': 'Checking links & assets for broken responses',
  'security-headers': 'Inspecting security headers & cookies',
  'seo-content': 'Running SEO & content checks',
  'tech-stack': 'Fingerprinting tech stack',
  performance: 'Measuring performance snapshot',
  'tls-security': 'Analyzing TLS/SSL certificate',
  'dns-domain': 'Checking DNS records & domain registration',
  'exposed-files': 'Probing for exposed sensitive files',
  'vulnerable-libs': 'Scanning for known-vulnerable JS libraries',
};

const SEVERITY_COLOR = {
  high: chalk.redBright,
  medium: chalk.yellowBright,
  low: chalk.greenBright,
};

function printBanner() {
  const logo = chalk.greenBright(figlet.textSync('AuditCLI', { font: 'ANSI Shadow' }));
  const divider = chalk.green('·······················❀·······················');
  const tagline = chalk.whiteBright.bold('Website Health, Security & Content Auditor');
  const subtitle = chalk.gray('Professional-grade auditing for engineering, security & marketing teams.');

  console.log(
    boxen([logo, divider, tagline, subtitle].join('\n'), {
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { bottom: 1 },
      borderStyle: 'round',
      borderColor: 'green',
    })
  );
}

function printSectionHeader(title) {
  console.log('\n' + chalk.bold.greenBright(`▸ ${title}`));
  console.log(chalk.dim('  ' + '─'.repeat(Math.max(40, title.length + 2))));
}

// OSC 8 terminal hyperlink -- renders as a clickable link in modern terminals
// (VS Code, Windows Terminal, iTerm2); degrades to plain text elsewhere.
function hyperlink(label, url) {
  const esc = String.fromCharCode(27);
  const bel = String.fromCharCode(7);
  return esc + "]8;;" + url + bel + label + esc + "]8;;" + bel;
}

function printSummaryBox(result) {
  const high = result.issues.filter(i => i.severity === 'high').length;
  const med = result.issues.filter(i => i.severity === 'medium').length;
  const low = result.issues.filter(i => i.severity === 'low').length;

  const lines = [
    `${chalk.bold('Target:')} ${result.targetUrl}`,
    `${chalk.bold('Pages crawled:')} ${result.pagesCrawled}   ${chalk.bold('Assets found:')} ${result.assetsFound}   ${chalk.bold('Links found:')} ${result.linksFound}`,
    `${chalk.bold('Performance score:')} ${scoreColor(result.performance.details.score)}/100   ${chalk.bold('Risk score:')} ${scoreColor(result.riskScore)}/100`,
    `${chalk.bold('Tech stack:')} ${result.techStack.length ? result.techStack.join(', ') : chalk.gray('none detected')}`,
    ``,
    `${chalk.redBright(`● High: ${high}`)}   ${chalk.yellowBright(`● Medium: ${med}`)}   ${chalk.greenBright(`● Low: ${low}`)}   ${chalk.bold(`Total: ${result.issues.length}`)}`,
  ];

  if (result.crawlBlocked) {
    lines.push(chalk.gray('Note: site returned a bot-protection challenge; coverage limited to that response.'));
  }

  if (result.peerStats) {
    const p = result.peerStats;
    if (p.isIssueOutlier) {
      const direction = p.issueCountVsPeerAvg > 0 ? 'more' : 'fewer';
      lines.push('', chalk.gray(`Peer comparison: ${Math.abs(p.issueCountVsPeerAvg)}% ${direction} issues than the ${p.peerCount}-competitor average (z=${p.issueZScore}) — statistical outlier.`));
    }
  }

  console.log(boxen(lines.join('\n'), { padding: 1, margin: { top: 1, bottom: 1 }, borderColor: 'green', title: 'Audit Summary', titleAlignment: 'center' }));
}

function scoreColor(score) {
  if (score >= 80) return chalk.greenBright(score);
  if (score >= 50) return chalk.yellowBright(score);
  return chalk.redBright(score);
}

function printIssuesTable(issues, limit) {
  const sorted = [...issues].sort((a, b) => sevWeight(a.severity) - sevWeight(b.severity));
  const shown = limit ? sorted.slice(0, limit) : sorted;

  const table = new Table({
    head: [chalk.bold('Severity'), chalk.bold('Type'), chalk.bold('URL'), chalk.bold('Detail')],
    colWidths: [10, 22, 38, 50],
    wordWrap: true,
  });

  for (const issue of shown) {
    const colorFn = SEVERITY_COLOR[issue.severity] || chalk.white;
    table.push([colorFn(issue.severity), issue.type, truncate(issue.url, 36), issue.detail]);
  }

  console.log(table.toString());
  if (limit && sorted.length > limit) {
    console.log(chalk.gray(`  ...and ${sorted.length - limit} more (see full report / --json for all).\n`));
  }
}

function printCompetitorTable(target, competitors) {
  const table = new Table({
    head: [chalk.bold('Metric'), chalk.bold(hostOf(target.targetUrl)), ...competitors.map(c => chalk.bold(hostOf(c.targetUrl)))],
  });
  table.push(
    ['Performance score', scoreColor(target.performance.details.score), ...competitors.map(c => scoreColor(c.performance.details.score))],
    ['Issues found', target.issues.length, ...competitors.map(c => c.issues.length)],
    ['Pages crawled', target.pagesCrawled, ...competitors.map(c => c.pagesCrawled)],
    ['Tech stack', target.techStack.join(', ') || '—', ...competitors.map(c => c.techStack.join(', ') || '—')]
  );
  console.log(chalk.bold.greenBright('\nCompetitor Comparison\n'));
  console.log(table.toString());

  // simple auto-generated pros/cons vs first competitor
  if (competitors[0]) {
    const c = competitors[0];
    console.log(chalk.bold('\nQuick take vs ' + hostOf(c.targetUrl) + ':'));
    if (target.performance.details.score > c.performance.details.score) {
      console.log(chalk.green(`  ✔ Pro: You're faster (${target.performance.details.score} vs ${c.performance.details.score}).`));
    } else {
      console.log(chalk.red(`  ✘ Con: They're faster (${c.performance.details.score} vs ${target.performance.details.score}).`));
    }
    if (target.issues.length < c.issues.length) {
      console.log(chalk.green(`  ✔ Pro: Fewer issues found (${target.issues.length} vs ${c.issues.length}).`));
    } else {
      console.log(chalk.red(`  ✘ Con: More issues found (${target.issues.length} vs ${c.issues.length}).`));
    }
  }
  console.log('');
}

function sevWeight(s) {
  return { high: 0, medium: 1, low: 2 }[s] ?? 3;
}
function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return url; }
}

// A little "someone's out there walking the site for you" spinner instead
// of the default braille dots — purely cosmetic, degrades harmlessly if a
// terminal can't render the emoji width correctly.
const WALKING_SPINNER = {
  interval: 140,
  frames: ['🚶       ', ' 🚶      ', '  🚶     ', '   🚶    ', '    🚶   ', '     🚶  ', '      🚶 ', '       🚶'],
};

async function auditWithSpinner(url, maxPages) {
  const spinner = ora({ text: `Starting audit of ${url}`, spinner: WALKING_SPINNER }).start();
  try {
    const result = await runAudit(url, {
      maxPages,
      onProgress: (step) => { spinner.text = STEP_LABELS[step] || step; },
    });
    spinner.stopAndPersist({ symbol: '👍', text: chalk.green(`Audit complete for ${url}`) });
    return result;
  } catch (err) {
    spinner.stopAndPersist({ symbol: '❌', text: chalk.red(`Audit failed for ${url}: ${err.message}`) });
    throw err;
  }
}

function printAiSummary(ai) {
  printSectionHeader('AI Executive Summary');
  if (!ai) return;
  if (!ai.ok) {
    console.log(chalk.gray(`  AI summary unavailable (${ai.reason}${ai.error ? ': ' + ai.error : ''}).`));
    if (ai.reason === 'missing-api-key') {
      console.log(chalk.gray('  Add OPENROUTER_API_KEY to .env (free key at https://openrouter.ai/keys) to enable.'));
    }
    return;
  }
  console.log(chalk.gray(`  (model: ${ai.model}${ai.cached ? ', cached' : ''}, grounded via RAG retrieval against a curated vulnerability knowledge base)`));
  if (ai.overallHealth) console.log('  ' + chalk.whiteBright(ai.overallHealth) + '\n');

  if (!ai.items || !ai.items.length) return;
  const table = new Table({
    head: [chalk.bold('Issue'), chalk.bold('Root Cause'), chalk.bold('Suggested Fix')],
    colWidths: [22, 34, 34],
    wordWrap: true,
  });
  for (const item of ai.items) {
    const rootCause = item.source ? `${item.rootCause}\n${chalk.dim(`(via: ${item.source})`)}` : item.rootCause;
    table.push([item.issue, rootCause, item.fix]);
  }
  console.log(table.toString());
}

async function pushIssuesToJira(target, { silent = false } = {}) {
  const config = jiraConfigFromEnv();
  if (!config) {
    if (!silent) {
      console.log(chalk.yellow(`\n⚠ --jira flag set, but Jira env vars are missing.`));
      console.log(chalk.gray(`  Create a .env file with JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY.`));
    }
    return;
  }
  if (!target.issues.length) {
    console.log(chalk.green('\n✔ No issues found — nothing to file in Jira.'));
    return;
  }
  const spinner = ora(`Creating ${target.issues.length} Jira tickets...`).start();
  const results = await fileIssuesToJira(config, target.issues);
  results.forEach((r, i) => { if (r.ok) target.issues[i].jiraKey = r.key; });
  const created = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  spinner.stopAndPersist({ symbol: '👍', text: `Created ${created.length}/${target.issues.length} Jira tickets in ${config.projectKey}` });
  if (failed.length) {
    console.log(chalk.red(`  ${failed.length} tickets failed to create. First error: ${failed[0].error}`));
  }
}

async function pushSummaryToSlack(target) {
  const config = slackConfigFromEnv();
  if (!config) {
    console.log(chalk.yellow(`\n⚠ --slack flag set, but Slack env vars are missing.`));
    console.log(chalk.gray(`  Create a .env file with SLACK_BOT_TOKEN and SLACK_CHANNEL_ID.`));
    return;
  }
  const spinner = ora('Posting summary to Slack...').start();
  const result = await postSummaryToSlack(config, target);
  if (result.ok) spinner.stopAndPersist({ symbol: '👍', text: 'Posted audit summary to Slack' });
  else spinner.stopAndPersist({ symbol: '❌', text: `Slack post failed: ${result.error}` });
}

program
  .name('auditcli')
  .description('Audit a website for broken links, security headers, SEO issues, tech stack, and more.')
  .version('0.2.0');

program
  .command('scan <url>')
  .description('Run a full audit against a website')
  .option('-c, --compare <urls>', 'Comma-separated competitor URLs to compare against')
  .option('--discover-competitors', 'Auto-discover 3 similar/competitor sites via web search (best-effort)')
  .option('-p, --pages <n>', 'Max pages to crawl', (v) => parseInt(v, 10), 15)
  .option('-j, --jira', 'Auto-create Jira tickets for every issue found (requires .env config)')
  .option('-s, --slack', 'Post a summary of findings to Slack (requires .env config)')
  .option('-o, --out <dir>', 'Directory to save the report', './audit-reports')
  .option('--format <fmt>', 'Save an extra deliverable file: pdf or md (the dashboard/PDF button need no flag)', 'none')
  .option('--limit <n>', 'Max issues to print in terminal table', (v) => parseInt(v, 10), 25)
  .option('--json', 'Print raw JSON result instead of formatted tables')
  .option('--no-ai', 'Skip the AI root-cause analysis (on by default; needs OPENROUTER_API_KEY in .env)')
  .option('--no-web', 'Skip opening the interactive dashboard (by default it opens automatically after every scan)')
  .option('-a, --all', 'Do everything: security checks + AI summary + auto-discover competitors (does not auto-file Jira/Slack — use --jira/--slack, or push from the dashboard, when you actually want that)')
  .action(async (url, opts) => {
    if (opts.all) {
      opts.discoverCompetitors = true;
    }

    printBanner();
    if (opts.all) {
      console.log(chalk.magentaBright('  --all mode: full security scan + AI summary + competitor discovery + Jira + dashboard\n'));
    }

    let target;
    try {
      target = await auditWithSpinner(url, opts.pages);
    } catch (_) {
      process.exit(1);
    }

    const competitors = [];
    const manualUrls = opts.compare ? opts.compare.split(',').map(s => s.trim()).filter(Boolean) : [];
    let compUrls = [...manualUrls];
    // Explicit --compare URLs are always audited. Discovered candidates are
    // over-fetched and treated as a ranked pool: we keep trying down the list
    // until enough audit successfully, so one unreachable candidate doesn't
    // silently shrink the comparison set.
    let targetCompetitorCount = manualUrls.length;

    if (opts.discoverCompetitors) {
      const discoverSpinner = ora('Searching for similar/competitor sites...').start();
      const { competitors: discovered, seed } = await discoverCompetitors(target.targetUrl, target.rootPageHtml, { limit: 8 });
      if (discovered.length) {
        discoverSpinner.stopAndPersist({ symbol: '🐦', text: `Found ${discovered.length} candidate site(s) for "${seed}"` });
        compUrls = [...new Set([...compUrls, ...discovered])];
        targetCompetitorCount += 3;
      } else {
        discoverSpinner.stopAndPersist({ symbol: '⚠️', text: 'No competitor candidates found (search may be rate-limited) — try --compare <urls> manually.' });
      }
    }

    for (const cUrl of compUrls) {
      if (competitors.length >= targetCompetitorCount) break;
      try {
        competitors.push(await auditWithSpinner(cUrl, opts.pages));
      } catch (_) {
        console.log(chalk.gray(`  ${hostOf(cUrl)} unreachable — trying next candidate`));
      }
    }
    target.competitors = competitors;
    target.peerStats = peerRelativeStats(target, competitors);

    if (opts.ai) {
      const aiSpinner = ora('Generating AI executive summary...').start();
      target.aiSummary = await generateAiSummary(target);
      if (target.aiSummary.ok) {
        const via = target.aiSummary.cached ? 'served from cache — no API request' : `via ${target.aiSummary.model}`;
        aiSpinner.stopAndPersist({ symbol: '🌸', text: `AI root-cause analysis ready (RAG-grounded, ${via})` });
      }
      else aiSpinner.stopAndPersist({ symbol: '⚠️', text: `AI summary skipped (${target.aiSummary.reason})` });
    }

    if (opts.json) {
      console.log(JSON.stringify({ target, competitors }, null, 2));
      return;
    }

    printSummaryBox(target);
    if (opts.ai) printAiSummary(target.aiSummary);
    printSectionHeader('Issues Found');
    printIssuesTable(target.issues, opts.limit);

    if (competitors.length) {
      printCompetitorTable(target, competitors);
    }

    // Jira integration (before saving report, so ticket keys get persisted into the JSON)
    if (opts.jira) {
      await pushIssuesToJira(target);
    }
    if (opts.slack) {
      await pushSummaryToSlack(target);
    }

    // Always saves the JSON snapshot (powers the dashboard). Only writes an
    // extra deliverable file (PDF/MD) if --format was explicitly passed —
    // no .html file is ever written to disk.
    if (opts.format === 'none') {
      await saveReport(target, opts.out, 'none');
    } else {
      const saveSpinner = ora(`Rendering ${opts.format.toUpperCase()} report...`).start();
      try {
        const reportPath = await saveReport(target, opts.out, opts.format);
        saveSpinner.stopAndPersist({ symbol: '👍', text: `Report saved: ${reportPath}` });
      } catch (err) {
        saveSpinner.stopAndPersist({ symbol: '❌', text: `Could not render ${opts.format.toUpperCase()} report: ${err.message}` });
      }
    }

    if (opts.web) {
      await launchDashboard(opts.out, target.targetUrl, undefined, { emphasize: true });
    } else {
      console.log(chalk.gray(`\n  Report saved to ${opts.out}. Run "auditcli view" any time for the interactive dashboard.`));
    }

    console.log('');
  });

program
  .command('view [url]')
  .description('Open the interactive web dashboard for a saved report (most recent if no URL given)')
  .option('-o, --out <dir>', 'Directory reports were saved to', './audit-reports')
  .option('--port <n>', 'Dashboard port', (v) => parseInt(v, 10))
  .action(async (url, opts) => {
    printBanner();
    const reports = listReports(opts.out);
    if (!reports.length) {
      console.log(chalk.yellow('No saved reports found. Run `auditcli scan <url>` first.'));
      return;
    }
    await launchDashboard(opts.out, url, opts.port);
  });

async function launchDashboard(outDir, targetUrl, portOverride, { emphasize = false } = {}) {
  const port = portOverride || parseInt(process.env.DASHBOARD_PORT, 10) || 4545;
  const spinner = ora('Starting local dashboard server...').start();
  try {
    const host = targetUrl ? safeHostName(targetUrl) : undefined;
    const { url } = await startDashboard(outDir, { port, host, autoOpen: true });
    spinner.stop();

    if (emphasize) {
      const lines = [
        chalk.bold.green('👍 Report ready'),
        '',
        chalk.bold.greenBright(hyperlink('▸ Open interactive report', url)),
        chalk.gray(url),
        '',
        chalk.gray('Filter issues, review the AI summary, and push tickets to Jira with one click.'),
      ];
      console.log(boxen(lines.join('\n'), { padding: 1, margin: { top: 1 }, borderColor: 'green', title: 'AuditCLI Dashboard', titleAlignment: 'center' }));
    } else {
      console.log(chalk.green(`👍 Dashboard running at ${chalk.bold(hyperlink(url, url))} (opened in your browser)`));
    }
    console.log(chalk.gray('  Press Ctrl+C to stop the server.\n'));
  } catch (err) {
    spinner.fail(`Could not start dashboard: ${err.message}`);
  }
}

program.parse(process.argv);
