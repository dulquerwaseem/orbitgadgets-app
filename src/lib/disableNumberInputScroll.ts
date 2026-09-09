// Chrome (and some other browsers) change a focused number input's value
// when the page is scrolled with the cursor over it -- staff kept
// accidentally editing quantity/price/etc fields while scrolling the page.
// Blurring the input as soon as a wheel event reaches it, before the
// browser applies its default "adjust value" action for that same event,
// stops the value from changing while leaving the page free to scroll
// normally. Installed once, globally, so no individual number input
// anywhere in the app needs its own handler.
export function installNumberInputScrollGuard() {
  document.addEventListener(
    'wheel',
    (e) => {
      const target = e.target
      if (target instanceof HTMLInputElement && target.type === 'number') {
        target.blur()
      }
    },
    { passive: true },
  )
}
