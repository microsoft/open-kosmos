/**
 * make sure the input data is base64 format
 */
export function base64ToBlob(base64: string, mime?: string) {
  const [prefix, content] = base64.split(',');
  if (!mime) {
    mime = prefix.split(';')[0];
    mime = mime.split(':')[1] || 'image/png';
  }

  const data = atob(content);
  let n = data.length;
  const u8 = new Uint8Array(n);
  while (n--) u8[n] = data.charCodeAt(n);

  return new Blob([u8], { type: mime });
}


/**
 * !important: execute this in iframe may be blocked by permission
 */
export function shareImage(
  image: Blob,
  fileName: string,
): Promise<void> {
  if (navigator.share && navigator.canShare) {
    const file = new File([image], fileName, { type: image.type });
    const dataToShare = {
      files: [file],
      text: fileName,
      title: 'Screenshot',
    };
    if (navigator.canShare(dataToShare)) {
      return navigator.share(dataToShare);
    }
  }

  return Promise.reject();
}
