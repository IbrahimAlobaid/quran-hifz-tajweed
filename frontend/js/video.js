import { el } from "./util.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export function icon(d, fill = true) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", fill ? "currentColor" : "none");
  if (!fill) { p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linejoin", "round"); }
  svg.append(p);
  return svg;
}
export const PLAY = "M8 5l11 7-11 7z";

/**
 * A YouTube video card: {id, title, start?, by?, len?}.
 * YouTube decides per viewer whether an embed may play: for viewers it cannot
 * recognise (not signed in, flagged network) it shows «sign in to confirm
 * you're not a bot», which a site cannot bypass. So the card offers both: open
 * the video on YouTube (always works) or try the embed here. The embed uses
 * www.youtube.com, which can see a signed-in viewer, rather than
 * youtube-nocookie.com, which never can.
 */
export function videoCard(v) {
  const id = encodeURIComponent(v.id);
  const start = v.start ? +v.start : 0;
  const watch = `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;
  const box = el("div", { class: "video" });
  const here = el("button", { type: "button", class: "btn" }, icon(PLAY), "شاهد هنا");
  here.addEventListener("click", () => {
    const params = new URLSearchParams({ autoplay: "1", rel: "0", playsinline: "1" });
    if (start) params.set("start", String(start));
    box.replaceChildren(el("iframe", {
      src: `https://www.youtube.com/embed/${id}?${params}`,
      title: v.title, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true,
      referrerpolicy: "strict-origin-when-cross-origin",
    }));
    caption.hidden = false;
  });
  box.append(el("div", { class: "video__facade" },
    el("span", { class: "video__title" }, v.title),
    v.by ? el("span", { class: "muted video__by" }, v.len ? `${v.by}، ${v.len}` : v.by) : null,
    el("span", { class: "video__actions" },
      el("a", { class: "btn btn--primary", href: watch, target: "_blank", rel: "noopener" }, "افتح في YouTube"),
      here)));
  const caption = el("figcaption", { class: "video__alt", hidden: true },
    "إن طلب YouTube تسجيل الدخول فافتح المقطع هناك: ",
    el("a", { href: watch, target: "_blank", rel: "noopener" }, "افتح في YouTube"));
  return el("figure", { class: "video-item" }, box, caption);
}
