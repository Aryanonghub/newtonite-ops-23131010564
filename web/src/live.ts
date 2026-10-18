import { useEffect, useRef } from 'react';
import { getToken } from './api';

// Listens to a live-updates stream (text/event-stream) and calls onChange for every "change" event.
// fetch() is used instead of EventSource because EventSource cannot send the Authorization header,
// and putting the token in the URL would leak it into logs. The server ends each stream after
// about 25 s; this reconnects straight away, and waits a few seconds after a network error.
export function useLiveUpdates(path: string, onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const abort = new AbortController();
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    (async () => {
      while (!abort.signal.aborted) {
        try {
          const res = await fetch(`/api${path}`, {
            headers: { Authorization: `Bearer ${getToken()}` },
            signal: abort.signal,
          });
          if (res.status >= 400 && res.status < 500) return; // no access or gone: retrying won't help
          if (!res.ok || !res.body) throw new Error(`live stream failed (${res.status})`);

          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            // Events are separated by a blank line.
            let end;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const event = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (event.startsWith('event: change')) onChangeRef.current();
            }
          }
        } catch {
          if (abort.signal.aborted) return;
          await sleep(3000); // network error: back off a little before reconnecting
        }
      }
    })();

    return () => abort.abort();
  }, [path]);
}
