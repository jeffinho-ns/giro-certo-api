# Sistema de Imagens - Giro Certo API

Todas as imagens do sistema (perfis de usuário, fotos de motos, logos de lojistas, imagens de posts, etc.) são armazenadas diretamente no banco de dados PostgreSQL usando o tipo `BYTEA`.

## 📋 Estrutura

### Tabela Image

```sql
CREATE TABLE "Image" (
  id TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,  -- 'user', 'bike', 'partner', 'post', 'promotion'
  "entityId" TEXT NOT NULL,     -- ID da entidade relacionada
  filename TEXT NOT NULL,
  mimetype TEXT NOT NULL,       -- 'image/jpeg', 'image/png', etc
  size INTEGER NOT NULL,        -- tamanho em bytes
  data BYTEA NOT NULL,          -- dados binários da imagem
  "isPrimary" BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);
```

## 🚀 Endpoints

### Upload de Imagem

```http
POST /api/images/upload/:entityType/:entityId
Content-Type: multipart/form-data
Authorization: Bearer <token>

Form Data:
- image: <arquivo>
- isPrimary: true/false (opcional)
```

**Exemplo:**
```bash
curl -X POST \
  http://localhost:3001/api/images/upload/user/USER_ID \
  -H "Authorization: Bearer TOKEN" \
  -F "image=@/path/to/image.jpg" \
  -F "isPrimary=true"
```

**Resposta:**
```json
{
  "image": {
    "id": "image_id",
    "entityType": "user",
    "entityId": "user_id",
    "filename": "image.jpg",
    "mimetype": "image/jpeg",
    "size": 12345,
    "isPrimary": true,
    "url": "/api/images/image_id",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Buscar Imagem

```http
GET /api/images/:imageId
```

Retorna os dados binários da imagem com os headers apropriados.

**Exemplo:**
```bash
curl http://localhost:3001/api/images/image_id
```

### Listar Imagens de uma Entidade

```http
GET /api/images/entity/:entityType/:entityId
Authorization: Bearer <token>
```

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3001/api/images/entity/user/USER_ID
```

### Deletar Imagem

```http
DELETE /api/images/:imageId
Authorization: Bearer <token>
```

### Definir Imagem como Primária

```http
PATCH /api/images/:imageId/primary
Authorization: Bearer <token>
```

## 📝 Tipos de Entidades

- `user` - Foto de perfil do usuário
- `bike` - Foto da moto
- `partner` - Logo/foto do parceiro/lojista
- `post` - Imagens de posts da comunidade
- `promotion` - Imagens de promoções

## 💡 Uso nas Rotas Existentes

As rotas existentes retornam automaticamente URLs de imagens quando disponíveis:

```json
{
  "user": {
    "id": "user_id",
    "name": "João",
    "imageUrl": "/api/images/image_id"  // URL da imagem primária
  }
}
```

## 🔒 Permissões

- Usuários só podem fazer upload/deletar imagens de suas próprias entidades
- Para `entityType: user`, o `entityId` deve corresponder ao `userId` do token
- Outros tipos podem ter regras específicas de permissão

## 📦 Limites

- Tamanho máximo: 10MB por imagem
- Formatos aceitos: Todos os tipos MIME que começam com `image/`
- Armazenamento: PostgreSQL BYTEA (dados binários)

## 🔄 Integração com Front-end

### Flutter

```dart
// Upload de imagem
final request = http.MultipartRequest(
  'POST',
  Uri.parse('$baseUrl/api/images/upload/user/$userId'),
);
request.headers['Authorization'] = 'Bearer $token';
request.files.add(await http.MultipartFile.fromPath('image', imagePath));
request.fields['isPrimary'] = 'true';

// Exibir imagem
Image.network('$baseUrl/api/images/$imageId')
```

### Next.js

```typescript
// Upload de imagem
const formData = new FormData();
formData.append('image', file);
formData.append('isPrimary', 'true');

await fetch(`${API_URL}/api/images/upload/user/${userId}`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
  },
  body: formData,
});

// Exibir imagem
<img src={`${API_URL}/api/images/${imageId}`} />
```

## 🎯 Exemplos de Uso

### 1. Upload de Foto de Perfil

```bash
POST /api/images/upload/user/USER_ID
- image: foto.jpg
- isPrimary: true
```

### 2. Upload de Foto de Moto

```bash
POST /api/images/upload/bike/BIKE_ID
- image: moto.jpg
- isPrimary: true
```

### 3. Upload de Múltiplas Imagens em um Post

```bash
POST /api/images/upload/post/POST_ID
- image: imagem1.jpg
- isPrimary: false

POST /api/images/upload/post/POST_ID
- image: imagem2.jpg
- isPrimary: true  # Primeira imagem é a principal
```

### 4. Buscar URL da Imagem Primária

As rotas existentes já retornam `imageUrl` quando há imagem primária cadastrada.

## ⚠️ Notas Importantes

1. **Performance**: Imagens grandes podem impactar a performance. Considere comprimir antes do upload.
2. **Backup**: Certifique-se de incluir a tabela `Image` nos backups do banco.
3. **Limpeza**: Imagens órfãs (sem entidade relacionada) podem ser limpas periodicamente.
4. **Cache**: Considere implementar cache HTTP para as imagens frequentemente acessadas.
