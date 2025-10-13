// app.js — простой чат-клиент для «Знатока»
document.addEventListener('DOMContentLoaded', () => {
  const chatContainer = document.getElementById('chat-container');
  const questionInput = document.getElementById('question-input');
  const sendBtn = document.getElementById('send-btn');
  const themeToggle = document.getElementById('theme-toggle');

  // Отправка вопроса
  async function sendQuestion() {
    const question = questionInput.value.trim();
    if (!question) return;

    // Очистка поля
    questionInput.value = '';
    sendBtn.disabled = true;

    // Показываем сообщение пользователя
    addMessage(question, 'user');

    // Показываем "печатает..."
    const loadingId = 'loading-' + Date.now();
    addMessage('<em>Ищу в документах...</em>', 'bot', loadingId);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question,
          user_department: 'all' // можно заменить на выбор отдела
        })
      });

      // Удаляем "печатает..."
      document.getElementById(loadingId)?.remove();

      if (!response.ok) {
        throw new Error(`Ошибка: ${response.status}`);
      }

      const data = await response.json();
      let answerHtml = data.answer;

      // Добавляем источники
      if (data.sources && data.sources.length > 0) {
        const sourcesHtml = data.sources.map(src =>
          `<span class="source-chip">${escapeHtml(src.source)}</span>`
        ).join('');
        answerHtml += `<div class="mt-2">${sourcesHtml}</div>`;
      }

      addMessage(answerHtml, 'bot');
    } catch (err) {
      document.getElementById(loadingId)?.remove();
      addMessage(`❌ Ошибка: ${err.message}`, 'bot');
    } finally {
      sendBtn.disabled = false;
      questionInput.focus();
    }
  }

  function addMessage(text, sender, id = null) {
    const div = document.createElement('div');
    div.className = `message ${sender}-message`;
    if (id) div.id = id;
    div.innerHTML = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Обработчики
  sendBtn.addEventListener('click', sendQuestion);
  questionInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendQuestion();
  });

  // Переключение темы
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-bs-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', next);
    localStorage.setItem('znatok-theme', next);
    themeToggle.textContent = next === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  });

  // Восстановление темы
  const savedTheme = localStorage.getItem('znatok-theme') || 'dark';
  document.documentElement.setAttribute('data-bs-theme', savedTheme);
  themeToggle.textContent = savedTheme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
});