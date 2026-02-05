import { GlobalConfig } from '../../config/global.ts';
import type { Pr } from '../../modules/platform/types.ts';
import type { BranchConfig } from '../../workers/types.ts';
import { buildWebhookPayload, notifyWebhooks } from './webhooks.ts';
import * as httpMock from '~test/http-mock.ts';
import { logger } from '~test/util.ts';

describe('util/http/webhooks', () => {
  beforeEach(() => {
    GlobalConfig.reset();
  });

  afterEach(() => {
    httpMock.clear();
  });

  describe('buildWebhookPayload', () => {
    const mockPr: Pr = {
      number: 123,
      title: 'Update dependency lodash to v4.17.21',
      sourceBranch: 'renovate/lodash-4.x',
      targetBranch: 'main',
      state: 'open',
      createdAt: '2024-01-15T10:30:00Z',
      isDraft: false,
      labels: ['dependencies'],
    };

    const mockConfig: BranchConfig = {
      repository: 'owner/repo',
      branchName: 'renovate/lodash-4.x',
      baseBranch: 'main',
      manager: 'npm',
      upgrades: [
        {
          branchName: 'renovate/lodash-4.x',
          depName: 'lodash',
          currentValue: '4.17.20',
          newValue: '4.17.21',
          currentVersion: '4.17.20',
          newVersion: '4.17.21',
          updateType: 'patch',
          packageFile: 'package.json',
          manager: 'npm',
          datasource: 'npm',
        } as any,
      ],
      isGroup: false,
      isVulnerabilityAlert: false,
      updateType: 'patch',
    };

    it('builds payload for PR creation on GitHub', () => {
      GlobalConfig.set({
        platform: 'github',
        endpoint: 'https://api.github.com',
      });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(payload).toMatchObject({
        event: 'pull_request.created',
        repository: {
          name: 'owner/repo',
          platform: 'github',
        },
        pullRequest: {
          number: 123,
          title: 'Update dependency lodash to v4.17.21',
          sourceBranch: 'renovate/lodash-4.x',
          targetBranch: 'main',
          url: 'https://api.github.com/owner/repo/pull/123',
          state: 'open',
          labels: ['dependencies'],
        },
        upgrades: [
          {
            depName: 'lodash',
            currentValue: '4.17.20',
            newValue: '4.17.21',
            updateType: 'patch',
            packageFile: 'package.json',
            manager: 'npm',
          },
        ],
        branchConfig: {
          isGroup: false,
          isVulnerabilityAlert: false,
          isLockFileMaintenance: false,
          updateType: 'patch',
        },
      });
      expect(payload.timestamp).toBeDefined();
      expect(new Date(payload.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('builds payload for PR update on GitLab', () => {
      GlobalConfig.set({
        platform: 'gitlab',
        endpoint: 'https://gitlab.com',
      });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'gitlab',
        'pull_request.updated',
      );

      expect(payload.event).toBe('pull_request.updated');
      expect(payload.repository.platform).toBe('gitlab');
      expect(payload.pullRequest.url).toBe(
        'https://gitlab.com/owner/repo/-/merge_requests/123',
      );
    });

    it('builds payload with multiple upgrades', () => {
      const configWithMultipleUpgrades: BranchConfig = {
        ...mockConfig,
        upgrades: [
          {
            branchName: 'renovate/lodash-4.x',
            depName: 'lodash',
            currentValue: '4.17.20',
            newValue: '4.17.21',
            updateType: 'patch',
            manager: 'npm',
          } as any,
          {
            branchName: 'renovate/axios-1.x',
            depName: 'axios',
            currentValue: '0.21.0',
            newValue: '1.0.0',
            updateType: 'major',
            manager: 'npm',
          } as any,
        ],
      };

      const payload = buildWebhookPayload(
        configWithMultipleUpgrades,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(payload.upgrades).toHaveLength(2);
      expect(payload.upgrades[0].depName).toBe('lodash');
      expect(payload.upgrades[1].depName).toBe('axios');
    });

    it('handles group updates', () => {
      const groupConfig: BranchConfig = {
        ...mockConfig,
        isGroup: true,
      };

      const payload = buildWebhookPayload(
        groupConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(payload.branchConfig.isGroup).toBe(true);
    });

    it('handles vulnerability alerts', () => {
      const vulnConfig: BranchConfig = {
        ...mockConfig,
        isVulnerabilityAlert: true,
      };

      const payload = buildWebhookPayload(
        vulnConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(payload.branchConfig.isVulnerabilityAlert).toBe(true);
    });

    it('handles lock file maintenance', () => {
      const lockFileConfig: BranchConfig = {
        ...mockConfig,
        updateType: 'lockFileMaintenance',
      };

      const payload = buildWebhookPayload(
        lockFileConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(payload.branchConfig.isLockFileMaintenance).toBe(true);
    });

    it('handles missing repository', () => {
      const configWithoutRepo: BranchConfig = {
        ...mockConfig,
        repository: undefined,
      };

      const payload = buildWebhookPayload(
        configWithoutRepo,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(payload.repository.name).toBe('unknown');
      expect(payload.pullRequest.url).toBe('');
    });

    it('handles missing upgrades', () => {
      const configWithoutUpgrades = {
        ...mockConfig,
        upgrades: undefined,
      } as unknown as BranchConfig;

      const payload = buildWebhookPayload(
        configWithoutUpgrades,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(payload.upgrades).toEqual([]);
    });

    it('constructs Bitbucket URL correctly', () => {
      GlobalConfig.set({
        platform: 'bitbucket',
        endpoint: 'https://bitbucket.org',
      });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'bitbucket',
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toBe(
        'https://bitbucket.org/owner/repo/pull-requests/123',
      );
    });

    it('constructs Bitbucket Server URL correctly', () => {
      GlobalConfig.set({
        platform: 'bitbucket-server',
        endpoint: 'https://bitbucket.company.com',
      });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'bitbucket-server',
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toBe(
        'https://bitbucket.company.com/projects/owner/repo/pull-requests/123',
      );
    });

    it('constructs Gitea URL correctly', () => {
      GlobalConfig.set({
        platform: 'gitea',
        endpoint: 'https://gitea.com',
      });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'gitea',
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toBe(
        'https://gitea.com/owner/repo/pulls/123',
      );
    });

    it('constructs Azure DevOps URL correctly', () => {
      GlobalConfig.set({
        platform: 'azure',
        endpoint: 'https://dev.azure.com',
      });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'azure',
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toBe(
        'https://dev.azure.com/owner/repo/pullrequest/123',
      );
    });

    it('constructs generic URL for unknown platform', () => {
      GlobalConfig.set({
        endpoint: 'https://git.example.com',
      });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'unknown-platform' as any,
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toBe(
        'https://git.example.com/owner/repo/pr/123',
      );
    });

    it('uses default GitHub endpoint when not configured', () => {
      GlobalConfig.set({ platform: 'github' });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toContain('https://github.com');
    });

    it('uses default GitLab endpoint when not configured', () => {
      GlobalConfig.set({ platform: 'gitlab' });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'gitlab',
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toContain('https://gitlab.com');
    });

    it('uses default Bitbucket endpoint when not configured', () => {
      GlobalConfig.set({ platform: 'bitbucket' });

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'bitbucket',
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toContain('https://bitbucket.org');
    });

    it('uses empty string for unknown platform without endpoint', () => {
      GlobalConfig.set({});

      const payload = buildWebhookPayload(
        mockConfig,
        mockPr,
        'unknown' as any,
        'pull_request.created',
      );

      expect(payload.pullRequest.url).toBe('/owner/repo/pr/123');
    });
  });

  describe('notifyWebhooks', () => {
    const mockPr: Pr = {
      number: 456,
      title: 'Update dependency',
      sourceBranch: 'renovate/test',
      targetBranch: 'main',
      state: 'open',
    };

    const mockConfig: BranchConfig = {
      repository: 'test/repo',
      branchName: 'renovate/test',
      baseBranch: 'main',
      prWebhooks: ['https://webhook.example.com/renovate'],
      upgrades: [],
      manager: 'npm',
    };

    beforeEach(() => {
      GlobalConfig.set({ platform: 'github' });
    });

    it('sends webhook notification successfully', async () => {
      httpMock
        .scope('https://webhook.example.com')
        .post('/renovate')
        .reply(200);

      await notifyWebhooks(
        mockConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(httpMock.getTrace()).toHaveLength(1);
      const [request] = httpMock.getTrace();
      expect(request.url).toBe('https://webhook.example.com/renovate');
      expect(request.method).toBe('POST');
      expect(request.body).toBeDefined();
      expect(logger.logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          prWebhooks: ['https://webhook.example.com/renovate'],
        }),
        'notifyWebhooks called',
      );
    });

    it('sends webhooks to multiple URLs in parallel', async () => {
      const multiWebhookConfig: BranchConfig = {
        ...mockConfig,
        prWebhooks: [
          'https://webhook1.example.com/hook',
          'https://webhook2.example.com/hook',
        ],
      };

      httpMock.scope('https://webhook1.example.com').post('/hook').reply(200);
      httpMock.scope('https://webhook2.example.com').post('/hook').reply(200);

      await notifyWebhooks(
        multiWebhookConfig,
        mockPr,
        'github',
        'pull_request.updated',
      );

      expect(httpMock.getTrace()).toHaveLength(2);
    });

    it('handles webhook failure gracefully', async () => {
      httpMock
        .scope('https://webhook.example.com')
        .post('/renovate')
        .reply(500, 'Internal Server Error');

      await notifyWebhooks(
        mockConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://webhook.example.com/renovate',
          pr: 456,
        }),
        'Webhook notification failed',
      );
    });

    it('continues sending to other webhooks if one fails', async () => {
      const multiWebhookConfig: BranchConfig = {
        ...mockConfig,
        prWebhooks: [
          'https://webhook1.example.com/hook',
          'https://webhook2.example.com/hook',
        ],
      };

      httpMock.scope('https://webhook1.example.com').post('/hook').reply(500);
      httpMock.scope('https://webhook2.example.com').post('/hook').reply(200);

      await notifyWebhooks(
        multiWebhookConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(httpMock.getTrace()).toHaveLength(2);
      expect(logger.logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://webhook2.example.com/hook',
        }),
        'Webhook notification sent successfully',
      );
    });

    it('handles network errors gracefully', async () => {
      httpMock
        .scope('https://webhook.example.com')
        .post('/renovate')
        .replyWithError('Network error');

      await notifyWebhooks(
        mockConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://webhook.example.com/renovate',
        }),
        'Webhook notification failed',
      );
    });

    it('does nothing when no webhook URLs configured', async () => {
      const configWithoutWebhooks: BranchConfig = {
        ...mockConfig,
        prWebhooks: [],
      };

      await notifyWebhooks(
        configWithoutWebhooks,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(httpMock.getTrace()).toHaveLength(0);
      expect(logger.logger.debug).toHaveBeenCalledWith(
        'No webhook URLs configured, skipping notifications',
      );
    });

    it('does nothing when prWebhooks is undefined', async () => {
      const configWithoutWebhooks: BranchConfig = {
        ...mockConfig,
        prWebhooks: undefined,
      };

      await notifyWebhooks(
        configWithoutWebhooks,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(httpMock.getTrace()).toHaveLength(0);
    });

    it('includes upgrade data in webhook payload', async () => {
      const configWithUpgrades: BranchConfig = {
        ...mockConfig,
        upgrades: [
          {
            branchName: 'renovate/test-package-2.x',
            depName: 'test-package',
            currentValue: '1.0.0',
            newValue: '2.0.0',
            updateType: 'major',
            manager: 'npm',
          } as any,
        ],
      };

      httpMock
        .scope('https://webhook.example.com')
        .post('/renovate', (body: any) => {
          expect(body.upgrades).toHaveLength(1);
          expect(body.upgrades[0].depName).toBe('test-package');
          expect(body.upgrades[0].newValue).toBe('2.0.0');
          return true;
        })
        .reply(200);

      await notifyWebhooks(
        configWithUpgrades,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(httpMock.getTrace()).toHaveLength(1);
    });

    it('logs debug message with webhook URLs', async () => {
      httpMock
        .scope('https://webhook.example.com')
        .post('/renovate')
        .reply(200);

      await notifyWebhooks(
        mockConfig,
        mockPr,
        'github',
        'pull_request.created',
      );

      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookUrls: ['https://webhook.example.com/renovate'],
          event: 'pull_request.created',
          pr: 456,
        }),
        'Sending webhook notifications',
      );
    });
  });
});
