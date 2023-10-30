import {inspect} from "util";
import {GitHub} from "@actions/github/lib/utils";
import * as core from "@actions/core";

export async function getPullRequestBodyHistoryAscending(owner: string, repo: string, number: number, octokit: InstanceType<typeof GitHub>): Promise<string[]> {

    const query = `
        query ($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              userContentEdits(first: 100) {
                nodes {
                  createdAt
                  diff
                }
                totalCount
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }`;

    let data;

    let cursor = null;

    let count = 0;

    const edits = new Array<{ createdAt: string; diff: string }>();

    let iteration = 0;

    do {

        const variables: { owner: string; cursor: any; number: number; repo: string } = {owner, repo, number, cursor};

        data = (await octokit.graphql<{
            data: {
                repository: {
                    pullRequest: {
                        userContentEdits: {
                            nodes: Array<{
                                createdAt: string;
                                diff: string;
                            }>;
                            totalCount: number;
                            pageInfo: {
                                hasNextPage: boolean;
                                endCursor: string;
                            };
                        }
                    }
                }
            }
        }>(query, variables)).data;

        cursor = data?.repository?.pullRequest?.userContentEdits?.pageInfo?.endCursor;

        count = data?.repository?.pullRequest?.userContentEdits?.totalCount ?? 0;

        iteration++;

        core.startGroup(`Pipeline issues iteration #${iteration}`);

        core.info(inspect({

            payload: {query, variables},

            cursor,

            data
        }));

        core.endGroup();

        (data?.repository?.pullRequest?.userContentEdits?.nodes ?? []).forEach(edit => edits.push(edit));

    } while (data?.repository?.pullRequest?.userContentEdits?.pageInfo?.hasNextPage === true);

    if (edits.length !== count) {

        throw new Error(`Expected ${count} issues but queried ${edits.length}.`);
    }

    return edits.map(edit => ({diff: edit.diff, createdAt: new Date(edit.createdAt)}))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(edit => edit.diff);
}