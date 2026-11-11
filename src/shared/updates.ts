/** `GET /api/admin/updates`: the running version and the newest release, if Hearth has asked. */
export interface UpdateStatus {
  current: string;
  /** The admin has the daily check on. */
  checking: boolean;
  checkedAt?: string;
  error?: string;
  /** Built from source (no version number), so there's nothing to compare. */
  devBuild: boolean;
  /** The newest release's version, newer or not. */
  latest?: string;
  /** A newer release than this one. */
  available?: {
    version: string;
    name: string;
    url: string;
    /** The release notes (Markdown, from the changelog). */
    notes: string;
    publishedAt: string;
  };
  releasesUrl: string;
}
