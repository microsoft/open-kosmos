import { uuid } from "../../context";
import { Rect } from "../../type";

export const POP_WIN_NAME = uuid();

let singleton: WindowProxy | null = null;
export function popup(url: string, feature: string) {
  singleton = window.open(url, POP_WIN_NAME, feature);
}

export type FormField = {
  type: 'string';
  name: string;
  value: string;
} | {
  type: 'file';
  name: string;
  value: File;
};

const sleep = (ms: number) => new Promise(rs => setTimeout(rs, ms));

export async function formPost(
  url: string,
  winFeat: string,
  fields: FormField[],
) {
  const form = document.createElement('form');
  form.action = url;
  form.method = 'POST';
  form.target = POP_WIN_NAME;
  form.encoding = 'multipart/form-data';
  form.style.position = 'absolute';
  form.style.display = 'none';
  fields.forEach((field) => {
    const input = document.createElement('input');
    if (field.type === 'string') {
      input.type = 'hidden';
      input.name = field.name;
      input.value = field.value;
    } else if (field.type === 'file') {
      input.type = 'file';
      input.name = field.name;
      const dt = new DataTransfer();
      dt.items.add(field.value);
      input.files = dt.files;
    }
    form.appendChild(input);
  });
  document.body.appendChild(form);

  if (!singleton || singleton.closed) {
    singleton = window.open('about:blank', POP_WIN_NAME, winFeat);
    await sleep(500);
  }

  form.submit();
  setTimeout(() => form.remove(), 100);
}

export function makeWinFeature(area: Rect) {
  const [x, y, w, h] = area;
  const width = 375;
  const height = 750;
  const gap = 20;
  let left = window.innerWidth - width - gap;
  if (left < 0) left = 0;
  let top = window.innerHeight - height - gap;
  if (top < 0) top = 0;
  return `left=${left},top=${top},width=${width},height=${height}`;
}
