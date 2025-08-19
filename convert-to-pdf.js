const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function convertToPdf(inputDir = 'downloaded_book', outputFile = 'book.pdf') {
  console.log(`Конвертация изображений из папки ${inputDir} в ${outputFile}`);
  
  // Проверяем существование папки
  if (!fs.existsSync(inputDir)) {
    console.error(`Папка ${inputDir} не существует`);
    return;
  }
  
  // Получаем список всех PNG файлов
  const files = fs.readdirSync(inputDir)
    .filter(file => file.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b)); // Сортируем по имени для правильного порядка страниц
  
  if (files.length === 0) {
    console.error('PNG файлы не найдены в папке', inputDir);
    return;
  }
  
  console.log(`Найдено ${files.length} страниц`);
  
  // Создаем PDF документ
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0
  });
  
  // Создаем поток для записи PDF
  const stream = fs.createWriteStream(outputFile);
  doc.pipe(stream);
  
  // Обрабатываем каждое изображение
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(inputDir, file);
    
    try {
      // Получаем информацию об изображении
      const metadata = await sharp(filePath).metadata();
      
      // Добавляем новую страницу с размерами изображения
      doc.addPage({
        size: [metadata.width, metadata.height],
        margin: 0
      });
      
      // Добавляем изображение на страницу
      doc.image(filePath, 0, 0, {
        width: metadata.width,
        height: metadata.height
      });
      
      // Показываем прогресс
      if ((i + 1) % 10 === 0 || i === files.length - 1) {
        console.log(`Обработано ${i + 1}/${files.length} страниц`);
      }
      
    } catch (error) {
      console.error(`Ошибка при обработке файла ${file}:`, error.message);
    }
  }
  
  // Завершаем создание PDF
  doc.end();
  
  // Ждем завершения записи
  await new Promise((resolve) => {
    stream.on('finish', () => {
      const stats = fs.statSync(outputFile);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`✅ PDF создан: ${outputFile} (${fileSizeMB} MB)`);
      resolve();
    });
  });
}

// Запуск конвертации
const inputDir = process.argv[2] || 'downloaded_book';
const outputFile = process.argv[3] || 'book.pdf';

console.log('Использование:');
console.log('  node convert-to-pdf.js [папка_с_изображениями] [имя_выходного_файла.pdf]');
console.log('Пример:');
console.log('  node convert-to-pdf.js downloaded_book my_book.pdf');
console.log('');

convertToPdf(inputDir, outputFile).catch(console.error);