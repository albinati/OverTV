# Certificados

`samsung/` **não é versionado** (chaves privadas). Conteúdo esperado, gerado pelo fluxo descrito no README principal:

| arquivo | o que é |
|---|---|
| `author.key.pem`, `author.csr`, `author.crt`, `author-and-ca.crt`, `author.p12` | certificado de autor (Samsung VD Author CA). **Guarde o `.p12`: só ele permite atualizar o app instalado.** |
| `distributor.key.pem`, `distributor.csr`, `dist_profile.pem`, `dist-and-ca.crt`, `distributor.p12` | certificado de distribuidor, com o DUID da TV no SAN |
| `device-profile.xml` | resposta da API v1 da Samsung; é enviado à TV a cada deploy ("permitir instalação") |

`ca/` tem as CAs públicas da Samsung extraídas da *Samsung Certificate Extension* do Tizen Studio
(`vd_tizen_dev_author_ca.cer`, `vd_tizen_dev_public2.crt`, ...).

Os `.p12` usam a senha definida em `.env` (`CERT_PASS`). Para o assinador em Node (node-forge),
exporte-os com `openssl pkcs12 -export -legacy`.
