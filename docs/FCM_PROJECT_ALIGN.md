# FCM na API — alinhar com o app (giro-certo-72def)

O app Flutter usa o projeto Firebase **`giro-certo-72def`** (token FCM / APNs).  
O Storage de imagens pode continuar em **`agilizaiapp-img`**.

## Variáveis no Render (produção)

Mantenha as de Storage (`FIREBASE_ADMIN_*` / bucket) como estão.

Adicione (service account do projeto **giro-certo-72def**):

```
FIREBASE_FCM_PROJECT_ID=giro-certo-72def
FIREBASE_FCM_CLIENT_EMAIL=...@giro-certo-72def.iam.gserviceaccount.com
FIREBASE_FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Ou:

```
FIREBASE_FCM_CREDENTIALS_JSON_BASE64=<base64 do JSON do service account>
```

## Como obter o JSON

1. Firebase Console → projeto **giro-certo** (`giro-certo-72def`)
2. ⚙️ Project settings → **Service accounts**
3. **Generate new private key**
4. No Render, cole os campos ou o base64

## Teste de despacho

1. iPhone: entregador logado, app em background / tela bloqueada  
2. Outro telefone: lojista → criar pedido → **Despachar**  
3. Esperado no iPhone: “Nova corrida disponível”

Nos logs da API (Render): `[FCM] OK ... type=delivery_offer` ou `[FCM] Falha token...`.
