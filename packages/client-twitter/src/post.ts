import { Tweet } from "agent-twitter-client";
import {
    composeContext,
    generateText,
    embeddingZeroVector,
    IAgentRuntime,
    ModelClass,
    stringToUuid,
} from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { ClientBase } from "./base";

const twitterPostTemplate = `{{timeline}}

# Knowledge
{{knowledge}}

About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{postDirections}}

{{providers}}

{{recentPosts}}

{{characterPostExamples}}

# Task: Generate a post in the voice and style of {{agentName}}, aka @{{twitterUserName}}
Write a single sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Try to write something totally different than previous posts. Do not add commentary or acknowledge this request, just write the post.
Your response should not contain any questions. Brief, concise statements only. No emojis. Use \\n\\n (double spaces) between statements.`;

const MAX_TWEET_LENGTH = 280;

/**
 * Truncate text to fit within the Twitter character limit, ensuring it ends at a complete sentence.
 */
function truncateToCompleteSentence(text: string): string {
    if (text.length <= MAX_TWEET_LENGTH) {
        return text;
    }

    // Attempt to truncate at the last period within the limit
    const truncatedAtPeriod = text.slice(
        0,
        text.lastIndexOf(".", MAX_TWEET_LENGTH) + 1
    );
    if (truncatedAtPeriod.trim().length > 0) {
        return truncatedAtPeriod.trim();
    }

    // If no period is found, truncate to the nearest whitespace
    const truncatedAtSpace = text.slice(
        0,
        text.lastIndexOf(" ", MAX_TWEET_LENGTH)
    );
    if (truncatedAtSpace.trim().length > 0) {
        return truncatedAtSpace.trim() + "...";
    }

    // Fallback: Hard truncate and add ellipsis
    return text.slice(0, MAX_TWEET_LENGTH - 3).trim() + "...";
}

export class TwitterPostClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    private tweetInterval: NodeJS.Timeout | null = null;
    private isProcessing: boolean = false;
    private readonly THIRTY_MINUTES = 30 * 60 * 1000; // 30 minutes in milliseconds
    private readonly RETRY_DELAY = 60 * 1000; // 1 minute retry delay

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.validateTiming(); // Start the timing validation
    }

    private validateTiming() {
        setInterval(async () => {
            const lastPost = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>(
                "twitter/" +
                    this.runtime.getSetting("TWITTER_USERNAME") +
                    "/lastPost"
            );
            const now = Date.now();
            const timeSinceLastPost = now - (lastPost?.timestamp ?? 0);

            if (timeSinceLastPost > this.THIRTY_MINUTES + 60000) {
                // 1 minute grace period
                elizaLogger.warn(
                    `Tweet interval exceeded 30 minutes by ${Math.floor((timeSinceLastPost - this.THIRTY_MINUTES) / 1000)} seconds`
                );
                // Force a new tweet if we're significantly behind schedule
                await this.generateAndScheduleNextTweet();
            }
        }, 60000); // Check every minute
    }

    async start(postImmediately: boolean = false) {
        if (!this.client.profile) {
            await this.client.init();
        }

        // Stop any existing intervals
        this.stopTweetLoop();

        if (postImmediately) {
            await this.generateAndScheduleNextTweet();
        } else {
            await this.scheduleNextTweet();
        }
    }

    private stopTweetLoop() {
        if (this.tweetInterval) {
            clearInterval(this.tweetInterval);
            this.tweetInterval = null;
        }
    }

    private async scheduleNextTweet() {
        try {
            const lastPost = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>(
                "twitter/" +
                    this.runtime.getSetting("TWITTER_USERNAME") +
                    "/lastPost"
            );

            const lastPostTimestamp = lastPost?.timestamp ?? 0;
            const now = Date.now();
            const timeSinceLastPost = now - lastPostTimestamp;

            // If more than 30 minutes has passed since last post, post immediately
            if (timeSinceLastPost >= this.THIRTY_MINUTES) {
                await this.generateAndScheduleNextTweet();
            } else {
                // Schedule for the remaining time
                const remainingTime = this.THIRTY_MINUTES - timeSinceLastPost;
                elizaLogger.log(
                    `Scheduling next tweet in ${Math.floor(remainingTime / 60000)} minutes`
                );

                this.tweetInterval = setTimeout(
                    () => this.generateAndScheduleNextTweet(),
                    remainingTime
                );
            }
        } catch (error) {
            elizaLogger.error("Error scheduling next tweet:", error);
            // On error, retry after 1 minute
            this.tweetInterval = setTimeout(
                () => this.scheduleNextTweet(),
                this.RETRY_DELAY
            );
        }
    }

    private async generateAndScheduleNextTweet() {
        // Prevent concurrent executions
        if (this.isProcessing) {
            elizaLogger.warn("Tweet generation already in progress, skipping");
            return;
        }

        this.isProcessing = true;
        try {
            await this.generateNewTweet();

            // Log exact timing for verification
            const nextTweetTime = new Date(Date.now() + this.THIRTY_MINUTES);
            elizaLogger.log(`Current time: ${new Date().toISOString()}`);
            elizaLogger.log(
                `Next tweet scheduled for: ${nextTweetTime.toISOString()}`
            );

            // After successful tweet, set up fixed interval for next tweet
            this.tweetInterval = setTimeout(
                () => this.generateAndScheduleNextTweet(),
                this.THIRTY_MINUTES
            );

            elizaLogger.log("Next tweet scheduled in 30 minutes");
        } catch (error) {
            elizaLogger.error("Error generating tweet:", error);
            // On error, retry after 1 minute
            this.tweetInterval = setTimeout(
                () => this.generateAndScheduleNextTweet(),
                this.RETRY_DELAY
            );
        } finally {
            this.isProcessing = false;
        }
    }

    private async generateNewTweet() {
        elizaLogger.log("Generating new tweet");

        try {
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.client.profile.username,
                this.runtime.character.name,
                "twitter"
            );

            let homeTimeline: Tweet[] = [];

            const cachedTimeline = await this.client.getCachedTimeline();

            if (cachedTimeline) {
                homeTimeline = cachedTimeline;
            } else {
                homeTimeline = await this.client.fetchHomeTimeline(10);
                await this.client.cacheTimeline(homeTimeline);
            }

            const formattedHomeTimeline =
                `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                homeTimeline
                    .map((tweet) => {
                        return `#${tweet.id}\n${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? `\nIn reply to: ${tweet.inReplyToStatusId}` : ""}\n${new Date(tweet.timestamp).toDateString()}\n\n${tweet.text}\n---\n`;
                    })
                    .join("\n");

            const topics = this.runtime.character.topics.join(", ");

            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: stringToUuid("twitter_generate_room"),
                    agentId: this.runtime.agentId,
                    content: {
                        text: topics,
                        action: "",
                    },
                },
                {
                    twitterUserName: this.client.profile.username,
                    timeline: formattedHomeTimeline,
                }
            );

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.twitterPostTemplate ||
                    twitterPostTemplate,
            });

            elizaLogger.debug("generate post prompt:\n" + context);

            const newTweetContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            // Replace \n with proper line breaks and trim excess spaces
            const formattedTweet = newTweetContent
                .replaceAll(/\\n/g, "\n")
                .trim();

            // Use the helper function to truncate to complete sentence
            const content = truncateToCompleteSentence(formattedTweet);

            if (this.runtime.getSetting("TWITTER_DRY_RUN") === "true") {
                elizaLogger.info(
                    `Dry run: would have posted tweet: ${content}`
                );
                return;
            }

            try {
                elizaLogger.log(`Posting new tweet:\n ${content}`);

                const result = await this.client.requestQueue.add(
                    async () =>
                        await this.client.twitterClient.sendTweet(content)
                );
                const body = await result.json();
                const tweetResult = body.data.create_tweet.tweet_results.result;

                const tweet = {
                    id: tweetResult.rest_id,
                    name: this.client.profile.screenName,
                    username: this.client.profile.username,
                    text: tweetResult.legacy.full_text,
                    conversationId: tweetResult.legacy.conversation_id_str,
                    createdAt: tweetResult.legacy.created_at,
                    userId: this.client.profile.id,
                    inReplyToStatusId:
                        tweetResult.legacy.in_reply_to_status_id_str,
                    permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                    hashtags: [],
                    mentions: [],
                    photos: [],
                    thread: [],
                    urls: [],
                    videos: [],
                } as Tweet;

                // Update last post timestamp immediately after successful tweet
                await this.runtime.cacheManager.set(
                    `twitter/${this.client.profile.username}/lastPost`,
                    {
                        id: tweet.id,
                        timestamp: Date.now(),
                    }
                );

                await this.client.cacheTweet(tweet);

                homeTimeline.push(tweet);
                await this.client.cacheTimeline(homeTimeline);
                elizaLogger.log(
                    `Tweet posted successfully at ${new Date().toISOString()}`
                );
                elizaLogger.log(`Tweet URL: ${tweet.permanentUrl}`);

                const roomId = stringToUuid(
                    tweet.conversationId + "-" + this.runtime.agentId
                );

                await this.runtime.ensureRoomExists(roomId);
                await this.runtime.ensureParticipantInRoom(
                    this.runtime.agentId,
                    roomId
                );

                await this.runtime.messageManager.createMemory({
                    id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: newTweetContent.trim(),
                        url: tweet.permanentUrl,
                        source: "twitter",
                    },
                    roomId,
                    embedding: embeddingZeroVector,
                    createdAt: tweet.timestamp * 1000,
                });
            } catch (error) {
                elizaLogger.error("Error sending tweet:", error);
                throw error; // Re-throw to trigger retry logic
            }
        } catch (error) {
            elizaLogger.error("Error in generateNewTweet:", error);
            throw error; // Re-throw to trigger retry logic
        }
    }
}
