// Prevent only the exact native-callback POST form from navigating to the custom URI.
(() => {
  if (window !== window.top || location.origin !== 'https://login.eduid.ch') return;
  const CALLBACK = 'ch.unibe.campusapp://campusapp.unibe.ch';
  function isCallbackForm(form) {
    if (!(form instanceof HTMLFormElement) || form.action !== CALLBACK || (form.method || '').toLowerCase() !== 'post') return false;
    const inputs = [...form.querySelectorAll('input')];
    if (!inputs.length || inputs.length > 16 || inputs.some(input => input.type !== 'hidden' || !input.name)) return false;
    const keys = inputs.map(input => input.name);
    if (new Set(keys).size !== keys.length) return false;
    const params = new URLSearchParams(inputs.map(input => [input.name, input.value]));
    return Boolean(params.get('state')) && (Boolean(params.get('code')) || params.has('error'));
  }
  function notify(form) {
    form.dataset.betteriliasCallbackReady = '1';
    document.dispatchEvent(new CustomEvent('BETTERILIAS_NATIVE_CALLBACK_FORM'));
  }
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  HTMLFormElement.prototype.submit = function (...args) {
    if (isCallbackForm(this)) { notify(this); return; }
    return nativeSubmit.apply(this, args);
  };
  if (typeof nativeRequestSubmit === 'function') {
    HTMLFormElement.prototype.requestSubmit = function (...args) {
      if (isCallbackForm(this)) { notify(this); return; }
      return nativeRequestSubmit.apply(this, args);
    };
  }
  window.addEventListener('submit', event => {
    if (isCallbackForm(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      notify(event.target);
    }
  }, true);
})();
