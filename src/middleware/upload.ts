import multer, { Multer, StorageEngine } from 'multer';
import path from 'path';
import fs from 'fs';

// Criar diretório de uploads se não existir
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configurar storage
const storage: StorageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Usar timestamp + nome original para evitar conflitos
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

// Filtro de arquivo
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Permitir apenas imagens
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Apenas imagens são permitidas (JPEG, PNG, GIF, WebP)'));
  }
};

// Configurar multer
export const upload: Multer = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// Helper para gerar URL da imagem
export const getImageUrl = (filename: string): string => {
  const baseUrl = process.env.API_URL || 'https://giro-certo-api.onrender.com';
  return `${baseUrl}/uploads/${filename}`;
};
