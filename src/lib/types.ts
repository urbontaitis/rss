export type EntryStatus = 'unread' | 'read' | 'removed'

export interface Category {
  id: number
  title: string
  hide_globally: boolean
  created_at: string
}

export interface Feed {
  id: number
  category_id: number | null
  title: string
  feed_url: string
  site_url: string
  icon_url: string
  description: string
  disabled: boolean
  hide_globally: boolean
  crawler: boolean
  ignore_http_cache: boolean
  no_media_player: boolean
  server_fetch: boolean
  user_agent: string
  cookie: string
  username: string
  password: string
  scraper_rules: string
  rewrite_rules: string
  url_rewrite_rules: string
  block_filter_entry_rules: string
  keep_filter_entry_rules: string
  etag: string
  last_modified: string
  checked_at: string | null
  parsing_error_count: number
  parsing_error_msg: string
  created_at: string
}

export interface Enclosure {
  url: string
  type: string
  length: number
}

export interface Entry {
  id: number
  feed_id: number
  hash: string
  title: string
  url: string
  comments_url: string
  author: string
  content: string
  tags: string[]
  enclosures: Enclosure[]
  reading_time: number
  status: EntryStatus
  starred: boolean
  published_at: string
  created_at: string
  changed_at: string
}

export interface EntryListItem {
  id: number
  feed_id: number
  title: string
  url: string
  comments_url: string
  author: string
  tags: string[]
  reading_time: number
  status: EntryStatus
  starred: boolean
  published_at: string
  created_at: string
  changed_at: string
  feed_title: string
  feed_site_url: string
  feed_icon_url: string
  category_id: number | null
  category_title: string | null
  hidden: boolean
}

export interface FeedCounter {
  feed_id: number
  category_id: number | null
  unread: number
  total: number
}

export interface ServerSettings {
  id: number
  block_filter_entry_rules: string
  keep_filter_entry_rules: string
  retention_days: number
  server_fetch_enabled: boolean
  updated_at: string
}

export interface FeedSnapshot {
  id: number
  feed_id: number
  body: string
  etag: string
  last_modified: string
  fetched_at: string
}

export interface ParsedItem {
  guid: string
  title: string
  url: string
  commentsUrl: string
  author: string
  content: string
  tags: string[]
  enclosures: Enclosure[]
  publishedAt: Date | null
}

export interface ParsedFeed {
  title: string
  siteUrl: string
  iconUrl: string
  description: string
  items: ParsedItem[]
}
