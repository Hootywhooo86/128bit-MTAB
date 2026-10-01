import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui';
import { setNowWatching } from '@/lib/video';
import { getVideoDownloads, onVideoDownloads, type VideoDownload } from '@/lib/video-downloads';

/** "Play downloaded" when this movie/episode is saved on the phone. */
export function DownloadedPlay({ itemKey }: { itemKey: string }) {
  const [d, setD] = useState<VideoDownload | undefined>();
  useEffect(() => {
    const pick = (list: VideoDownload[]) =>
      setD(list.find((x) => x.key === itemKey && x.state === 'done' && x.file));
    getVideoDownloads().then(pick);
    return onVideoDownloads(pick);
  }, [itemKey]);
  if (!d) return null;
  return (
    <Button
      label="▶  Play downloaded"
      onPress={() => {
        setNowWatching({
          key: d.key,
          title: d.title,
          subtitle: d.subtitle,
          poster: d.poster,
          uri: d.file!,
          link: d.link,
        });
        router.push('/watch');
      }}
    />
  );
}
