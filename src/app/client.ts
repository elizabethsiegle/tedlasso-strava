import { TUNING } from "../domain/tuning";

/**
 * Progressive enhancement only. Without this script the form still posts and
 * the browser navigates to the JSON response, which is ugly but not broken.
 */
export const REFRESH_SCRIPT = `
(function () {
  var form = document.getElementById("refresh-form");
  if (!form) return;
  var button = document.getElementById("refresh");
  var MIN_MS = ${TUNING.REFRESH_ANIMATION_MS};

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Warming up";
    document.body.setAttribute("data-refreshing", "true");

    var started = Date.now();
    fetch(form.action, { method: "POST", headers: { accept: "application/json" } })
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        var wait = Math.max(0, MIN_MS - (Date.now() - started));
        setTimeout(function () {
          if (payload && payload.ok) {
            window.location.reload();
          } else {
            button.disabled = false;
            button.textContent = "Try again";
            document.body.removeAttribute("data-refreshing");
          }
        }, wait);
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = "Try again";
        document.body.removeAttribute("data-refreshing");
      });
  });
})();
`;
