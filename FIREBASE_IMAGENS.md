# Firebase Storage - Upload de Imagens (Giro Certo)

As imagens (perfil, capa, posts, stories) são armazenadas no **Firebase Storage**, usando o mesmo projeto do vamos-comemorar, na pasta **giro-certo**.

## Configuração

### 1. Variáveis de ambiente (giro-certo-api)

Adicione ao `.env` (ou Render):

```
FIREBASE_STORAGE_BUCKET=agilizaiapp-img.firebasestorage.app
FIREBASE_ADMIN_PROJECT_ID=agilizaiapp-img
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxxx@agilizaiapp-img.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Ou, em alternativa, use o JSON do service account em base64:

```
FIREBASE_ADMIN_CREDENTIALS_JSON_BASE64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Ii...
```

### 2. Obter credenciais

1. Aceda ao [Firebase Console](https://console.firebase.google.com/)
2. Selecione o projeto **agilizaiapp-img** (ou o projeto usado pelo vamos-comemorar)
3. Definições do projeto → Contas de serviço → Gerar nova chave privada
4. Use os valores do JSON gerado

### 3. Estrutura no Storage

```
giro-certo/
├── profile/     (avatar, capa)
├── posts/       (imagens dos posts)
└── stories/     (mídia dos stories)
```

### 4. Fallback

Se as variáveis Firebase não estiverem configuradas, a API usa a tabela `Image` local (comportamento anterior). As URLs serão `/api/images/:id`.

## giro-certo-flutter

O app Flutter envia ficheiros para a API. A API faz o upload para o Firebase e devolve a URL pública. Nenhuma alteração é necessária no Flutter - as URLs do Firebase são públicas e carregam diretamente.

## Verificar se está configurado

```bash
node scripts/check-firebase.js
```

## Troubleshooting (imagens não exibem)

1. **Diagnóstico no app**: Configurações → Diagnóstico de Imagens (mostra o que a API retorna)
2. **API sem Firebase**: Se não configurado, a API usa a tabela `Image` local. O upload guarda em `/api/images/:id`
3. **Posts/stories sem imagens**: Se o diagnóstico mostrar `images: []` ou `mediaUrl: ""`, os posts/stories foram criados sem foto ou o upload falhou
4. **Regras do Storage**: Firebase Console → Storage → Rules. Para `giro-certo/` deve permitir leitura pública:
   ```
   match /giro-certo/{allPaths=**} {
     allow read: if true;
     allow write: if request.auth != null;
   }
   ```

## giro-certo-next

O dashboard admin exibe imagens através das URLs retornadas pela API. Nenhuma configuração Firebase é necessária no Next.js - as imagens são carregadas via `<img src={url} />`.
