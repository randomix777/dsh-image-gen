/**
 * Lightweight IndexedDB persistence layer for Image Generation Gallery.
 * Stores lightweight metadata indexes; image binaries remain managed by DSH Attachment service.
 * Supports tombstones to ensure deleted items are never resurrected when revisiting conversations.
 */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ImageProvider } from '../shared.js'

export interface GalleryItem {
  id: string
  attachment: ImageAttachmentRef
  prompt: string
  provider: ImageProvider
  model: string
  createdAt: number
  aspectRatio?: string
  imageSize?: string
  output?: string
}

const DB_NAME = 'dsh_image_gen_db'
const DB_VERSION = 3
const STORE_NAME = 'gallery_history'
const TOMBSTONE_STORE = 'gallery_tombstones'

/** Default page size for paginated gallery loads. */
export const GALLERY_PAGE_SIZE = 20

let dbPromise: Promise<IDBDatabase> | null = null
let tombstonesCache: Set<string> | null = null

/**
 * Serialize all read-write transactions so overlapping mutations on the same
 * object stores can never race to `TransactionInactiveError` and drop writes.
 * Read-only queries run concurrently and stay off this queue.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task)
  // Keep the chain alive even when a task rejects; never swallow the caller's
  // rejection, just make sure the next queued write still runs.
  writeQueue = result.catch(() => {})
  return result
}

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
        store.createIndex('createdAt_id', ['createdAt', 'id'], { unique: true })
      }
      if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) {
        db.createObjectStore(TOMBSTONE_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(request.error)
    }
  })
  return dbPromise
}

async function loadTombstones(db: IDBDatabase): Promise<Set<string>> {
  if (tombstonesCache) return tombstonesCache
  return new Promise<Set<string>>((resolve) => {
    if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) {
      tombstonesCache = new Set()
      resolve(tombstonesCache)
      return
    }
    try {
      const tx = db.transaction(TOMBSTONE_STORE, 'readonly')
      const store = tx.objectStore(TOMBSTONE_STORE)
      const req = store.getAllKeys()
      req.onsuccess = () => {
        tombstonesCache = new Set(req.result.map(String))
        resolve(tombstonesCache)
      }
      req.onerror = () => {
        tombstonesCache = new Set()
        resolve(tombstonesCache)
      }
    } catch {
      tombstonesCache = new Set()
      resolve(tombstonesCache)
    }
  })
}

type GalleryListener = () => void
const listeners = new Set<GalleryListener>()

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (err) {
      console.error('[dsh-image-gen] Gallery listener error:', err)
    }
  }
}

/**
 * Subscribe to gallery mutations (insert/delete/clear).
 */
export function subscribeGallery(listener: GalleryListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Save or update a gallery record by attachmentId.
 * Skipped if the item was previously deleted (tombstoned).
 */
export async function saveGalleryItem(
  item: Omit<GalleryItem, 'createdAt'> & { createdAt?: number }
): Promise<void> {
  try {
    await enqueueWrite(async () => {
      const db = await getDB()
      const tombstones = await loadTombstones(db)
      if (tombstones.has(item.id)) {
        return
      }
      const record: GalleryItem = {
        ...item,
        createdAt: item.createdAt ?? Date.now(),
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const req = store.put(record)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
    })
    notifyListeners()
  } catch (err) {
    console.warn('[dsh-image-gen] Failed to save gallery item to IndexedDB:', err)
  }
}

/**
 * Retrieve all gallery records sorted by createdAt descending.
 */
export async function getGalleryItems(): Promise<GalleryItem[]> {
  try {
    const db = await getDB()
    return await new Promise<GalleryItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('createdAt')
      const req = index.openCursor(null, 'prev') // newest first
      const items: GalleryItem[] = []

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          items.push(cursor.value as GalleryItem)
          cursor.continue()
        } else {
          resolve(items)
        }
      }
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('[dsh-image-gen] Failed to read gallery items from IndexedDB:', err)
    return []
  }
}

/**
 * Cursor for paginated gallery loads. Created from the last item on a page.
 */
export interface GalleryCursor {
  createdAt: number
  id: string
}

/**
 * Paginated gallery load result.
 */
export interface GalleryPage {
  items: GalleryItem[]
  /** Whether more items exist beyond this page. */
  hasMore: boolean
  /** Cursor to pass for the next page, or undefined if no more. */
  nextCursor?: GalleryCursor
}

/**
 * Retrieve a single page of gallery records (newest first), using the provided
 * cursor for pagination. Default page size is `GALLERY_PAGE_SIZE`.
 */
export async function getGalleryItemsPage(
  pageSize: number = GALLERY_PAGE_SIZE,
  cursor?: GalleryCursor,
): Promise<GalleryPage> {
  try {
    const db = await getDB()
    return await new Promise<GalleryPage>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('createdAt_id')

      // Build bounds for cursor-based pagination.
      // Items are ordered by [createdAt ASC, id ASC] in the compound index,
      // so we open the cursor in reverse ('prev') starting before the cursor.
      let upperBound: IDBKeyRange | undefined
      if (cursor !== undefined) {
        upperBound = IDBKeyRange.upperBound([cursor.createdAt, cursor.id], true)
      }

      const req = index.openCursor(upperBound, 'prev') // descending order
      const items: GalleryItem[] = []
      let hasMore = false
      let lastItem: GalleryItem | undefined

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
        if (cursor === null) {
          const result: GalleryPage = { items, hasMore }
          if (lastItem !== undefined) result.nextCursor = { createdAt: lastItem.createdAt, id: lastItem.id }
          resolve(result)
          return
        }
        const item = cursor.value as GalleryItem
        if (items.length >= pageSize) {
          hasMore = true
          resolve({ items, hasMore, nextCursor: { createdAt: lastItem!.createdAt, id: lastItem!.id } })
          return
        }
        items.push(item)
        lastItem = item
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('[dsh-image-gen] Failed to read paginated gallery items:', err)
    return { items: [], hasMore: false }
  }
}

/**
 * Delete a single gallery record by ID and record a tombstone.
 */
export async function deleteGalleryItem(id: string): Promise<void> {
  try {
    await enqueueWrite(async () => {
      const db = await getDB()
      const tombstones = await loadTombstones(db)
      tombstones.add(id)
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, TOMBSTONE_STORE], 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const tombstoneStore = tx.objectStore(TOMBSTONE_STORE)
        store.delete(id)
        tombstoneStore.put({ id, deletedAt: Date.now() })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    })
    notifyListeners()
  } catch (err) {
    console.warn('[dsh-image-gen] Failed to delete gallery item from IndexedDB:', err)
  }
}

/**
 * Clear all gallery records and reset tombstones.
 */
export async function clearGallery(): Promise<void> {
  try {
    await enqueueWrite(async () => {
      const db = await getDB()
      if (tombstonesCache) tombstonesCache.clear()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, TOMBSTONE_STORE], 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const tombstoneStore = tx.objectStore(TOMBSTONE_STORE)
        store.clear()
        tombstoneStore.clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    })
    notifyListeners()
  } catch (err) {
    console.warn('[dsh-image-gen] Failed to clear gallery in IndexedDB:', err)
  }
}
