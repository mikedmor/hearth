/** Files: the NAS's shared folders, each person through their own NAS account. */

/** `GET /api/files`: whether Files is set up, and whether this person may use it. */
export interface FilesStatus {
  /** The admin has set the NAS's address. */
  configured: boolean;
  /** The NAS's name for mapping shares (\\nas\share, smb://nas/share). */
  smbHost?: string;
  /** This person may use Files (their profile has a PIN, or it's the admin). */
  allowed: boolean;
  reason?: string;
  connected: boolean;
  /** Their NAS account's name, once connected. */
  account?: string;
}

export interface Share {
  name: string;
  /** "/photos" */
  path: string;
  /** Whether this person may only read it. */
  readOnly: boolean;
}

export interface Entry {
  name: string;
  path: string;
  dir: boolean;
  size?: number;
  /** Last changed, seconds since 1970. */
  mtime?: number;
}
