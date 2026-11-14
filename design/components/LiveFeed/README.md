# LiveFeed

The live feed panel, newest first; each new row blurs in.

**Props:** `items` (FeedItem props with `id`); `max` (default 5); `title`.

- Queue new events so at most one row arrives every 300ms.
