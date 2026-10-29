(function () {
  try {
    var value = localStorage.getItem('hospai.theme');
    if (value === 'light' || value === 'dark') {
      document.documentElement.setAttribute('data-theme', value);
    }
  } catch (e) {}
})();
