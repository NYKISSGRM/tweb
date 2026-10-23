// NYKISS Gram — the folder tab strip picks a pane by its index, so the panes must stand in the order of the tabs and the
// pane that is shown must be the one of the selected tab. When folders arrive in another order than they are listed the
// open tab shows another folder's pane (an empty list under «Все»). The tabs are the truth.

const SLIDING = ['slide-left', 'slide-right'];

export default function alignFolderPanes(container: HTMLElement, order: HTMLElement[], shown: HTMLElement | undefined) {
  if(!order.length || !shown) return false;
  // a switch animation is running: it owns the classes for now, the caller tries again after it
  if(order.some((pane) => SLIDING.some((name) => pane.classList.contains(name)))) return false;

  let changed = false;
  order.forEach((pane, idx) => {
    if(container.children[idx] === pane) return;
    container.insertBefore(pane, container.children[idx] || null);
    changed = true;
  });

  order.forEach((pane) => {
    const active = pane === shown;
    if(pane.classList.contains('active') === active) return;
    pane.classList.toggle('active', active);
    changed = true;
  });

  return changed;
}
