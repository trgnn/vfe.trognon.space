// Base URL for album media (thumbs / full / downloads).
//
// Empty string  → media served from the same origin (/assets/album/… , /assets/series/…).
// Blob base URL → media served from Vercel Blob, e.g.:
//     const VFE_MEDIA_BASE = 'https://xxxxxxxx.public.blob.vercel-storage.com';
//
// The path after the base is identical in both cases (assets/{album,series}/…),
// so switching providers is a one-line change here.
const VFE_MEDIA_BASE = 'https://9lp6yhxfhlqerqcw.public.blob.vercel-storage.com';
