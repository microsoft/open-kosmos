import { Rect } from "../type";
import { BackgroundImage } from "./utils/bg";
import { formPost, popup } from "./utils/pop-win";

function windowOffsetX() {
  const { screenX, innerWidth, outerWidth } = window;
  return screenX + (outerWidth - innerWidth);
}

function windowOffsetY() {
  const { screenY, innerHeight, outerHeight } = window;
  return screenY + (outerHeight - innerHeight);
}

function calcPositionByArea(area: Rect, width: number, height: number) {
  const [x, y, w, h] = area;
  const [winW, winH] = [window.innerWidth, window.innerHeight];
  const space = {
    left: x,
    right: winW - x - w,
    top: y,
    bottom: winH - y - h,
  };

  let [left, top] = [0, 0];
  if (space.top > space.bottom) {
    top = Math.max(0, y + h - height);
  } else {
    top = Math.min(y, winH - height);
  }

  const gap = 10;
  if (space.right >= (width + gap)) {
    left = x + w + gap;
  } else if (space.left >= (width + gap)) {
    left = x - width - gap;
  } else {
    left = winW - width;
  }

  return [
    Math.round(left) + windowOffsetX(),
    Math.round(top) + windowOffsetY(),
  ];
}

