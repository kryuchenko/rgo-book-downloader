const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Вспомогательная функция для конвертации blob URL в base64
async function blobToBase64(page, blobUrl) {
  return page.evaluate(async (url) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Ошибка при конвертации blob:', error);
      return null;
    }
  }, blobUrl);
}

async function downloadBook(bookUrl, outputDir = 'downloaded_book', startPage = 1) {
  console.log(`Начинаем скачивание книги: ${bookUrl}`);
  console.log(`Начальная страница: ${startPage}`);
  
  // Создаем папку для сохранения
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ 
    headless: true,
    timeout: 60000
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    // Переходим на страницу книги
    console.log('Открываем страницу книги...');
    await page.goto(bookUrl, { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });
    
    // Ждем загрузки первой страницы
    console.log('Ждем загрузки книги...');
    await page.waitForSelector('.page-img', { timeout: 30000 });
    
    // Ждем полной загрузки ВСЕХ изображений на странице
    console.log('Ожидаем полной загрузки всех изображений...');
    await page.waitForFunction(
      () => {
        const imgs = document.querySelectorAll('.page-img');
        console.log(`Проверяем загрузку ${imgs.length} изображений`);
        
        // Проверяем что все изображения загружены
        let allLoaded = true;
        for (let i = 0; i < imgs.length; i++) {
          if (!imgs[i].complete || imgs[i].naturalHeight === 0) {
            console.log(`Изображение ${i} еще не загружено`);
            allLoaded = false;
          }
        }
        
        return allLoaded && imgs.length > 0;
      },
      { timeout: 60000 }
    );
    
    console.log('Все изображения загружены. Дополнительная пауза...');
    await page.waitForTimeout(5000);
    
    // Если нужно начать не с первой страницы, переходим на нужную
    if (startPage > 1) {
      console.log(`Переход на страницу ${startPage}...`);
      const pageInput = await page.$('#page-number-input');
      if (pageInput) {
        // Очищаем поле и вводим новый номер
        await pageInput.click({ clickCount: 3 }); // Выделяем весь текст
        await pageInput.fill(String(startPage));
        await page.keyboard.press('Enter');
        
        // Ждем загрузки новой страницы
        console.log(`Ожидаем загрузки страницы ${startPage}...`);
        await page.waitForTimeout(1000);
        
        // Ждем появления изображения новой страницы
        await page.waitForFunction(
          () => {
            const imgs = document.querySelectorAll('.page-img');
            return imgs.length > 0 && imgs[imgs.length - 1].complete;
          },
          { timeout: 30000 }
        );
        
        await page.waitForTimeout(2000); // Дополнительная пауза для полной загрузки
        console.log(`Страница ${startPage} загружена`);
      }
    }
    
    // Получаем общее количество страниц
    const totalPagesText = await page.evaluate(() => {
      // Новый селектор для общего количества страниц
      const totalPagesElement = document.querySelector("body > div > div.viewer__main > div.viewer__top-nav.d-block.d-md-flex > div:nth-child(3) > span:nth-child(4)");
      if (totalPagesElement) {
        const text = totalPagesElement.textContent.trim();
        return parseInt(text) || null;
      }
      
      // Запасной вариант со старым селектором
      const pageInfo = document.querySelector('.page-info');
      if (pageInfo) {
        const text = pageInfo.textContent;
        const match = /из (\d+)/.exec(text);
        return match ? parseInt(match[1]) : null;
      }
      return null;
    });
    
    const totalPages = totalPagesText || 150; // По умолчанию 150 страниц
    console.log(`Всего страниц обнаружено: ${totalPages}`);
    console.log(`Селектор вернул: ${totalPagesText}`);
    
    // Функция для сохранения текущей страницы
    async function saveCurrentPage(pageNumber) {
      try {
        // Проверяем, существует ли уже файл
        const fileName = path.join(outputDir, `page_${String(pageNumber).padStart(4, '0')}.png`);
        if (fs.existsSync(fileName)) {
          console.log(`ℹ️ Страница ${pageNumber} уже существует, пропускаем`);
          return true;
        }
        // Ждем полной загрузки изображения
        await page.waitForSelector('.page-img', { state: 'visible', timeout: 10000 });
        await page.waitForTimeout(1000); // Дополнительная пауза для загрузки
        
        // Получаем изображение текущей видимой страницы
        const imgData = await page.evaluate((expectedPageNum) => {
          // Ищем страницу с нужным номером или видимую страницу
          const pageWrappers = document.querySelectorAll('.page-wrapper');
          console.log(`Найдено page-wrapper элементов: ${pageWrappers.length}`);
          
          let targetPageWrapper = null;
          
          // Сначала ищем по номеру страницы
          for (const wrapper of pageWrappers) {
            const pageAttr = wrapper.getAttribute('page');
            if (pageAttr && parseInt(pageAttr) === expectedPageNum) {
              targetPageWrapper = wrapper;
              break;
            }
          }
          
          // Если не нашли по номеру, ищем видимую страницу
          if (!targetPageWrapper) {
            for (const wrapper of pageWrappers) {
              const style = window.getComputedStyle(wrapper);
              if (style.display !== 'none' && style.zIndex !== '0') {
                targetPageWrapper = wrapper;
                break;
              }
            }
          }
          
          if (targetPageWrapper) {
            const img = targetPageWrapper.querySelector('.page-img');
            if (img?.complete && img.naturalHeight !== 0) {
              const pageNum = targetPageWrapper.getAttribute('page');
              console.log(`Используем изображение со страницы ${pageNum}`);
              return {
                src: img.src,
                pageNumber: parseInt(pageNum),
                total: pageWrappers.length
              };
            }
          }
          
          return null;
        }, pageNumber);
        
        if (!imgData?.src?.startsWith('blob:')) {
          console.log(`Страница ${pageNumber}: изображение не найдено или не blob (всего изображений: ${imgData?.total})`);
          return false;
        }
        
        console.log(`Страница ${pageNumber}: используем изображение со страницы ${imgData.pageNumber} из ${imgData.total}`);
        
        // Конвертируем blob в base64
        const base64Data = await blobToBase64(page, imgData.src);
        
        if (base64Data) {
          // Сохраняем изображение
          const base64Image = base64Data.split(',')[1];
          const buffer = Buffer.from(base64Image, 'base64');
          fs.writeFileSync(fileName, buffer);
          console.log(`✓ Сохранена страница ${pageNumber}/${totalPages}`);
          return true;
        } else {
          console.log(`✗ Не удалось сохранить страницу ${pageNumber}`);
          return false;
        }
      } catch (error) {
        console.error(`Ошибка при сохранении страницы ${pageNumber}:`, error.message);
        return false;
      }
    }
    
    // Сохраняем начальную страницу
    await saveCurrentPage(startPage);
    
    // Проходим по остальным страницам
    for (let i = startPage + 1; i <= totalPages; i++) {
      try {
        // Находим кнопку "Следующая страница"
        const nextButton = await page.$('.next-page-btn, [aria-label="Следующая страница"], .toolbar-button.next');
        
        if (nextButton) {
          await nextButton.click();
        } else {
          // Альтернативный способ - использовать клавиатуру
          await page.keyboard.press('ArrowRight');
        }
        
        // Ждем загрузки новой страницы
        console.log(`Ожидаем загрузки страницы ${i}...`);
        await page.waitForFunction(
          () => {
            const imgs = document.querySelectorAll('.page-img');
            // Проверяем что есть изображения и последнее загружено
            return imgs.length > 0 && 
                   imgs[imgs.length - 1].complete && 
                   imgs[imgs.length - 1].naturalHeight > 0;
          },
          { timeout: 30000 }
        );
        
        await page.waitForTimeout(1000); // Дополнительная пауза
        
        // Сохраняем страницу
        const saved = await saveCurrentPage(i);
        
        if (!saved) {
          console.log(`⚠️ Не удалось сохранить страницу ${i}, продолжаем...`);
          // Не прерываем, а продолжаем попытки
        }
        
      } catch (error) {
        console.error(`Ошибка при переходе на страницу ${i}:`, error.message);
        // Пытаемся продолжить
        continue;
      }
    }
    
    console.log(`\n✅ Скачивание завершено! Файлы сохранены в папку: ${outputDir}`);
    
  } catch (error) {
    console.error('Произошла ошибка:', error);
  } finally {
    await browser.close();
  }
}

// Запуск с URL книги и опциональной начальной страницей
const bookUrl = process.argv[2];
const startPage = Math.max(parseInt(process.argv[3]) || 1, 1); // Минимум 1
const outputDir = process.argv[4] || 'downloaded_book';

// Валидация входных параметров
if (!bookUrl) {
  console.error('❌ Ошибка: не указан URL книги');
  console.log('Использование: node download-book.js <URL> [начальная_страница] [папка_для_сохранения]');
  process.exit(1);
}

console.log('Использование:');
console.log('  node download-book.js <URL> [начальная_страница] [папка_для_сохранения]');
console.log('Пример:');
console.log('  node download-book.js "URL" 50 my_book');
console.log('');

downloadBook(bookUrl, outputDir, startPage).catch(console.error);