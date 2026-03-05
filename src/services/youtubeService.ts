/**
 * YouTube Search Service
 * Fetches learning resources for given topics using YouTube Data API v3.
 */

export interface YouTubeResource {
  topic: string;
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt: string;
  url: string;
}

class YoutubeService {
  private readonly apiKey: string | undefined;
  private readonly apiBase = 'https://www.googleapis.com/youtube/v3';

  constructor() {
    this.apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
  }

  /**
   * Search YouTube for each topic and return a list of videos.
   * De-dupes across topics and returns at most maxPerTopic per topic.
   */
  async searchByTopics(topics: string[], maxPerTopic: number = 3): Promise<YouTubeResource[]> {
    if (!topics || topics.length === 0) return [];
    if (!this.apiKey) {
      console.warn('[YouTube] Missing VITE_YOUTUBE_API_KEY; skipping fetch and returning empty list');
      return [];
    }

    const limitedTopics = topics.slice(0, 3); // avoid excessive requests and reduce quota usage
    const results: YouTubeResource[] = [];
    const seenVideoIds = new Set<string>();

    // Fetch topics sequentially to avoid hitting query-per-second limits
    for (const rawTopic of limitedTopics) {
      const topic = (rawTopic || '').toString().trim();
      if (!topic) continue;

      const q = this.buildQueryForSkill(topic);
      try {
        const url = `${this.apiBase}/search?part=snippet&maxResults=${maxPerTopic}&type=video&q=${encodeURIComponent(q)}&key=${this.apiKey}`;
        const response = await fetch(url);
        if (!response.ok) {
          console.warn('[YouTube] Non-OK response', response.status, await response.text());
          continue;
        }
        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items : [];

        for (const item of items) {
          const videoId = item?.id?.videoId;
          if (!videoId || seenVideoIds.has(videoId)) continue;
          seenVideoIds.add(videoId);

          const snippet = item?.snippet || {};
          const resource: YouTubeResource = {
            topic,
            videoId,
            title: snippet.title || 'Untitled',
            channelTitle: snippet.channelTitle || 'Unknown Channel',
            thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
            publishedAt: snippet.publishedAt || '',
            url: `https://www.youtube.com/watch?v=${videoId}`,
          };
          results.push(resource);
        }
      } catch (err) {
        console.error('[YouTube] Error searching for topic', topic, err);
      }
    }

    return results;
  }

  /**
   * Build a search query string tailored to a skill topic.
   */
  private buildQueryForSkill(skill: string): string {
    // Emphasize learning content
    const suffixes = ['tutorial', 'beginner', 'course', 'crash course', 'interview prep'];
    return `${skill} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
  }
}

export const youtubeService = new YoutubeService();


