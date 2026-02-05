import { GlobalConfig } from '../../config/global.ts';
import { logger } from '../../logger/index.ts';
import type { Pr } from '../../modules/platform/types.ts';
import type { BranchConfig } from '../../workers/types.ts';
import { Http } from './index.ts';

const http = new Http('webhook');

export type WebhookEventType = 'pull_request.created' | 'pull_request.updated';

export interface WebhookUpgrade {
  depName?: string;
  currentValue?: string;
  newValue?: string;
  currentVersion?: string;
  newVersion?: string;
  updateType?: string;
  packageFile?: string;
  manager?: string;
  datasource?: string;
}

export interface WebhookBranchConfig {
  isGroup: boolean;
  isVulnerabilityAlert: boolean;
  isLockFileMaintenance: boolean;
  updateType?: string;
}

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  repository: {
    name: string;
    platform: string;
  };
  pullRequest: {
    number: number;
    title: string;
    sourceBranch: string;
    targetBranch?: string;
    url: string;
    state: string;
    createdAt?: string;
    isDraft?: boolean;
    labels?: string[];
  };
  upgrades: WebhookUpgrade[];
  branchConfig: WebhookBranchConfig;
}

/**
 * Builds a webhook payload from branch configuration and PR data
 */
export function buildWebhookPayload(
  config: BranchConfig,
  pr: Pr,
  platformName: string,
  eventType: WebhookEventType,
): WebhookPayload {
  const upgrades: WebhookUpgrade[] = [];

  // Build upgrades list from config
  if (config.upgrades) {
    for (const upgrade of config.upgrades) {
      upgrades.push({
        depName: upgrade.depName,
        currentValue: upgrade.currentValue,
        newValue: upgrade.newValue,
        currentVersion: upgrade.currentVersion,
        newVersion: upgrade.newVersion,
        updateType: upgrade.updateType,
        packageFile: upgrade.packageFile,
        manager: upgrade.manager,
        datasource: upgrade.datasource,
      });
    }
  }

  // Build PR URL - construct based on platform
  const prUrl = constructPrUrl(config, pr, platformName);

  return {
    event: eventType,
    timestamp: new Date().toISOString(),
    repository: {
      name: config.repository ?? 'unknown',
      platform: platformName,
    },
    pullRequest: {
      number: pr.number,
      title: pr.title,
      sourceBranch: pr.sourceBranch,
      targetBranch: pr.targetBranch,
      url: prUrl,
      state: pr.state,
      createdAt: pr.createdAt,
      isDraft: pr.isDraft,
      labels: pr.labels,
    },
    upgrades,
    branchConfig: {
      isGroup: !!config.isGroup,
      isVulnerabilityAlert: !!config.isVulnerabilityAlert,
      isLockFileMaintenance: !!config.updateType?.includes(
        'lockFileMaintenance',
      ),
      updateType: config.updateType,
    },
  };
}

/**
 * Constructs the PR URL based on platform and repository configuration
 */
function constructPrUrl(
  config: BranchConfig,
  pr: Pr,
  platformName: string,
): string {
  const repo = config.repository;
  if (!repo) {
    return '';
  }

  // Try to extract base URL from endpoint or construct from platform
  const endpoint = GlobalConfig.get('endpoint');

  switch (platformName) {
    case 'github':
      return `${endpoint || 'https://github.com'}/${repo}/pull/${pr.number}`;
    case 'gitlab':
      return `${endpoint || 'https://gitlab.com'}/${repo}/-/merge_requests/${pr.number}`;
    case 'bitbucket':
      return `${endpoint || 'https://bitbucket.org'}/${repo}/pull-requests/${pr.number}`;
    case 'bitbucket-server':
      return `${endpoint}/projects/${repo}/pull-requests/${pr.number}`;
    case 'gitea':
      return `${endpoint}/${repo}/pulls/${pr.number}`;
    case 'azure':
      return `${endpoint}/${repo}/pullrequest/${pr.number}`;
    default:
      return `${endpoint || ''}/${repo}/pr/${pr.number}`;
  }
}

/**
 * Sends webhook notifications to all configured URLs
 * Failures are logged but do not throw errors
 */
export async function notifyWebhooks(
  config: BranchConfig,
  pr: Pr,
  platformName: string,
  eventType: WebhookEventType,
): Promise<void> {
  const webhookUrls = config.prWebhooks;

  if (!webhookUrls || webhookUrls.length === 0) {
    return;
  }

  const payload = buildWebhookPayload(config, pr, platformName, eventType);

  logger.debug(
    { webhookUrls, event: eventType, pr: pr.number },
    'Sending webhook notifications',
  );

  // Send to all webhooks in parallel
  const results = await Promise.allSettled(
    webhookUrls.map((url) => sendWebhook(url, payload)),
  );

  // Log any failures
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      logger.warn(
        { url: webhookUrls[i], err: result.reason, pr: pr.number },
        'Webhook notification failed',
      );
    } else {
      logger.debug(
        { url: webhookUrls[i], pr: pr.number },
        'Webhook notification sent successfully',
      );
    }
  }
}

/**
 * Sends a single webhook HTTP POST request
 */
async function sendWebhook(
  url: string,
  payload: WebhookPayload,
): Promise<void> {
  try {
    await http.postJson(url, {
      body: payload,
    });
  } catch (err) {
    logger.debug({ url, err }, 'Error sending webhook');
    throw err;
  }
}
