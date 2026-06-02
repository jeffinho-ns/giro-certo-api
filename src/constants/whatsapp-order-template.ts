/** Texto que o lojista envia ao cliente no WhatsApp (resposta deve seguir o mesmo formato). */
export const WHATSAPP_ORDER_TEMPLATE_PT = `Olá! Para confirmar seu pedido com entrega, copie e responda exatamente no formato abaixo.
Não altere os nomes dos campos (Nome, Telefone, CPF, Endereço completo, Valor do item, Confirmação).

Nome: [seu nome completo]
Telefone: [DDD + número]
CPF: [somente números]
Endereço completo: [rua, número, bairro, cidade, estado, complemento opcional]
Valor do item: [exemplo 45,90]
Confirmação: Sim

Exemplo preenchido:
Nome: Maria Silva
Telefone: (11) 98765-4321
CPF: 12345678909
Endereço completo: Rua das Flores, 100, Centro, São Paulo, SP, Apto 22
Valor do item: 45,90
Confirmação: Sim`;

export function looksLikeOrderFormMessage(text: string): boolean {
  const t = text.trim();
  return (
    /^\s*Nome\s*:/im.test(t) &&
    /^\s*Telefone\s*:/im.test(t) &&
    /^\s*Endere[cç]o\s+completo\s*:/im.test(t)
  );
}
