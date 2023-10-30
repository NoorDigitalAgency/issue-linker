import * as core from '@actions/core';
import {context, getOctokit} from '@actions/github';
import { ZenHubClient } from "@noordigitalagency/zenhub-client";
import { uniq } from 'lodash';
import {getPullRequestBodyHistoryAscending} from "./functions";

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {

    const token = core.getInput('token', {required: true});

    core.debug(`Token: '${token}'.`);

    const zenHubKey = core.getInput('zenhub-key');

    core.debug(`ZenHub Key: '${zenHubKey}'.`);

    const zenHubWorkflow = core.getInput('zenhub-workspace');

    core.debug(`ZenHub Workflow: '${zenHubWorkflow}'.`);

    const github = getOctokit(token);

    const reportMarker = '<!--Issue Marker Checker-->';

    const linkRegex = /(?:(?<owner>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)\/(?<repo>[A-Za-z0-9-._]+))?#(?<issue>\d+)/ig;

    const issueRegex = /https:\/\/api\.github\.com\/repos\/(?<repository>.+?)\/issues\/\d+/;

    const prNumber = context.payload.pull_request!.number;

    const owner = context.repo.owner;

    const repo = context.repo.repo;

    core.debug(`Owner: ${owner}, Repo: ${repo}, PR Number: ${prNumber}`);

    const history = await getPullRequestBodyHistoryAscending(owner, repo, prNumber, github);

    core.debug(`History: ${JSON.stringify(history)}`);

    const body = history.pop() ?? '';

    core.debug(`Body: ${body}`);

    const markerComments = (await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: prNumber })).filter(c => c.body?.startsWith(reportMarker));

    const links = [...body.matchAll(linkRegex)].map(link => link.groups)

        .filter((link, i, all) => all.findIndex(l => `${link!.owner?.toLowerCase() ?? owner}/${link!.repo?.toLowerCase() ?? repo}#${link!.issue}` === `${l!.owner?.toLowerCase() ?? owner}/${l!.repo?.toLowerCase() ?? repo}#${l!.issue}`) === i)

        .map(link => ({ ...link, owner: link!.owner ?? owner, repo: link!.repo ?? repo, issue: link!.issue}));

    core.debug(`Links: ${JSON.stringify(links)}`);

    const issues = [];

    const acceptedIssues = new Array<string>();

    for (const link of links) {

      try {

        const issue = (await github.rest.issues.get({ owner: link.owner, repo: link.repo, issue_number: +link.issue })).data;

        const { repository } = issue.url.match(issueRegex)!.groups as { repository: string };

        issues.push({ id: `${repository}#${link.issue}`, labels: issue.labels.map(label => (typeof(label) === 'string' ? label : label.name) ?? ''), open: issue.state !== 'closed', pr: issue.pull_request != null });

      } catch (e) { console.log(e); }
    }

    for (const comment of markerComments) {

      try {

        await github.rest.issues.deleteComment({ owner, repo, issue_numberL: prNumber, comment_id: comment.id });

      } catch (e) { console.log(e); }
    }

    const pullRequest = (await github.rest.issues.get({ owner, repo, issue_number: prNumber })).data;

    let markdown;

    if (issues.length === 0 || issues.every(i => i.labels.some(l => ['beta', 'production'].includes(l)) || !i.open || i.pr)) {

      markdown = `${reportMarker}⚠️⚠️<b>No issues to be marked!</b>⚠️⚠️\n@${pullRequest.user!.login}, please link the related issues <b>(if any)</b> either like \`#123\` or \`NoorDigitalAgency/repository-name#456\`.${issues.length > 0 ? '\n\n🗑️<b>Invalid links:</b>\n' : ''}`;

      if (issues.length > 0) {

        markdown += issues.reduce((previous, current, index) => `${previous}\n${index + 1}. ~~${current.id}~~ ${current.pr ? ' [🛑pull request]' : !current.open ? ' [📕closed]' : ` [🏷️labeled \`${current.labels.includes('beta') ? 'beta' : 'production'}\``}]`, '');
      }

    } else {

      let markedInvalids = false;

      markdown = `${reportMarker}✅<b>Issues to be marked!</b>\n- @${pullRequest.user!.login}, check the detected linked issues:\n${issues

          .sort((a,b) => (!a.pr && a.open && a.labels.every(l => !['beta', 'production'].includes(l))) === (!b.pr && b.open && b.labels.every(l => !['beta', 'production'].includes(l))) ? 0 : (!a.pr && a.open && a.labels.every(l => !['beta', 'production'].includes(l))) ? -1 : 0)

          .reduce((previous, current, index) =>

          {

            let line = `${current.id}`;

            let shouldMark = false;

            let invalid = false;
            
            if (current.pr || !current.open || current.labels.some(l => ['beta', 'production'].includes(l))) {

              invalid = true;
              
              shouldMark = !markedInvalids;

              markedInvalids = true;

              line = `~~${line}~~ ${current.pr ? ' [🛑pull request]' : !current.open ? ' [📕closed]' : ` [🏷️labeled \`${current.labels.includes('beta') ? 'beta' : 'production'}\`]`}`;

            } else if (current.labels.includes('alpha')) {

              line += ' [⚠️re-linking `alpha`]';
            }

            if (!invalid) {
              
              acceptedIssues.push(current.id);
            }
            
            return `${previous}\n${shouldMark ? '---\n' : ''}${index + 1}. ${line}`;

          }, '')}`;

      const issuesToConnect = uniq(acceptedIssues);

      core.debug(`Issues to connect: ${JSON.stringify(issuesToConnect)}`);

      const issuesToDisconnect = uniq(history.map(b => [...b.matchAll(linkRegex)].map(link => link.groups)

          .filter((link, i, all) => all.findIndex(l => `${link!.owner?.toLowerCase() ?? owner}/${link!.repo?.toLowerCase() ?? repo}#${link!.issue}` === `${l!.owner?.toLowerCase() ?? owner}/${l!.repo?.toLowerCase() ?? repo}#${l!.issue}`) === i)

          .map(link => ({ ...link, owner: link!.owner ?? owner, repo: link!.repo ?? repo, issue: link!.issue}))).flat().map(link => `${link.owner}/${link.repo}#${link.issue}`))

          .filter(i => !issuesToConnect.includes(i));

      core.debug(`Issues to disconnect: ${JSON.stringify(issuesToDisconnect)}`);

      const toConnectParts = issuesToConnect.map(i => ({...(Array.from(i.matchAll(linkRegex)).pop()!.groups)}));

      core.debug(`Connecting issue parts: ${JSON.stringify(toConnectParts)}`);

      const toConnect = toConnectParts.map(i => ({owner: i.owner, repo: i.repo, number: +i.issue}));

      core.debug(`Connecting issues: ${JSON.stringify(toConnect)}`);

      const toDisconnectParts = issuesToDisconnect.map(i => ({...(Array.from(i.matchAll(linkRegex)).pop()!.groups)}));

      core.debug(`Disconnecting issue parts: ${JSON.stringify(toDisconnectParts)}`);

      const toDisconnect = toDisconnectParts.map(i => ({owner: i.owner, repo: i.repo, number: +i.issue}));

      core.debug(`Disconnecting issues: ${JSON.stringify(toDisconnect)}`);

      const pr = {owner, repo, number: prNumber};

      core.debug(`Pull Request: ${JSON.stringify(pr)}`);

      if (toConnect.length > 0 || toDisconnect.length > 0) {

        core.debug('Connecting/disconnecting issues..');

        const client = new ZenHubClient(zenHubKey, zenHubWorkflow, github);

        if (toConnect.length > 0) {

          core.debug('Connecting issues..');

          await client.connectGitHubIssueToGitHubPullRequest(toConnect, pr);
        }

        if (toDisconnect.length > 0) {

          core.debug('Disconnecting issues..');

          await client.deleteIssuesFromPullRequest(toDisconnect, pr);
        }
      }
    }

    await github.rest.issues.createComment({owner, repo, issue_number: prNumber, body: markdown});

  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
