import {PracticeApp} from './practice-app.js?v=f3ab99c6cf25';
import {escapeHTML} from './learning.js?v=f3ab99c6cf25';

try {
  const response = await fetch(new URL('./data.json?v=f3ab99c6cf25', import.meta.url));
  if (!response.ok) throw new Error('The practice data could not be loaded.');
  window.keyChordApp = new PracticeApp(await response.json());
} catch (error) {
  document.getElementById('app').innerHTML = `<main class="loading"><h1>KeyChord could not open</h1><p>${escapeHTML(error.message)}</p><a href="../">Keyboard matrix</a></main>`;
  console.error(error);
}
