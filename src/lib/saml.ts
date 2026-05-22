import { sha256, signPkcs1v15, toBase64Utf8 } from "@/lib/utils";
import { xml } from "@/lib/xml";
import { INSECURE_PUBLIC_CERTIFICATE_CONTENT } from "@/lib/insecure-cert";

export interface AssertionData {
  assertionId: string;
  responseId: string;
  idpEntityId: string;
  subjectId: string;
  firstName: string;
  lastName: string;
  sessionId: string;
  now: string;
  expire: string;
  spAcsUrl: string;
  spEntityId: string;
}

export async function encodeAssertion(
  privateKey: CryptoKey,
  data: AssertionData,
): Promise<string> {
  const assertionElementWithNoSignature = createAssertionElement(data);
  const digest = await sha256(assertionElementWithNoSignature);

  const signedInfoElement = createSignedInfoElement(data.assertionId, digest);
  const signature = await signPkcs1v15(privateKey, signedInfoElement);

  const signatureElement = createSignatureElement(
    signature,
    signedInfoElement,
    createKeyInfoElement(INSECURE_PUBLIC_CERTIFICATE_CONTENT),
  );
  const signedAssertionElement = createAssertionElement(data, signatureElement);
  const responseElement = createResponseElement(data, signedAssertionElement);

  return toBase64Utf8(responseElement);
}

function createAssertionElement(
  data: AssertionData,
  signatureElement: string = "",
): string {
  return xml`
<saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${data.assertionId}" IssueInstant="${data.now}" Version="2.0">
  <saml2:Issuer Format="urn:oasis:names:tc:SAML:2.0:nameid-format:entity">${data.idpEntityId}</saml2:Issuer>
  ${signatureElement}
  <saml2:Subject>
    <saml2:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">${data.subjectId}</saml2:NameID>
    <saml2:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml2:SubjectConfirmationData InResponseTo="${data.sessionId}" NotOnOrAfter="${data.expire}" Recipient="${data.spAcsUrl}"></saml2:SubjectConfirmationData>
    </saml2:SubjectConfirmation>
  </saml2:Subject>
  <saml2:Conditions NotBefore="${data.now}" NotOnOrAfter="${data.expire}">
    <saml2:AudienceRestriction><saml2:Audience>${data.spEntityId}</saml2:Audience></saml2:AudienceRestriction>
  </saml2:Conditions>
  <saml2:AttributeStatement>
    <saml2:Attribute Name="email"><saml2:AttributeValue>${data.subjectId}</saml2:AttributeValue></saml2:Attribute>
    <saml2:Attribute Name="firstName"><saml2:AttributeValue>${data.firstName}</saml2:AttributeValue></saml2:Attribute>
    <saml2:Attribute Name="lastName"><saml2:AttributeValue>${data.lastName}</saml2:AttributeValue></saml2:Attribute>
  </saml2:AttributeStatement>
</saml2:Assertion>`;
}

function createSignedInfoElement(assertionId: string, digest: string): string {
  return xml`
<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:CanonicalizationMethod>
  <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod>
  <ds:Reference URI="#${assertionId}">
    <ds:Transforms>
      <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>
      <ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:Transform>
    </ds:Transforms>
    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
    <ds:DigestValue>${digest}</ds:DigestValue>
  </ds:Reference>
</ds:SignedInfo>`;
}

function createSignatureElement(
  signature: string,
  signedInfoElement: string,
  keyInfoElement: string,
): string {
  return xml`
<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  ${signedInfoElement}
  <ds:SignatureValue>${signature}</ds:SignatureValue>
  ${keyInfoElement}
</ds:Signature>`;
}

function createKeyInfoElement(certificate: string): string {
  return xml`
<ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ds:X509Data>
    <ds:X509Certificate>
      ${certificate}
    </ds:X509Certificate>
  </ds:X509Data>
</ds:KeyInfo>`;
}

function createStatusSuccessElement(): string {
  return xml`
<saml2p:Status>
  <saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"></saml2p:StatusCode>
</saml2p:Status>`;
}

function createResponseElement(
  data: AssertionData,
  assertionElement: string,
): string {
  return xml`
<saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol" Destination="${data.spAcsUrl}" ID="${data.responseId}" InResponseTo="${data.sessionId}" IssueInstant="${data.now}" Version="2.0">
  <saml2:Issuer xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" Format="urn:oasis:names:tc:SAML:2.0:nameid-format:entity">${data.idpEntityId}</saml2:Issuer>
  ${createStatusSuccessElement()}
  ${assertionElement}
</saml2p:Response>`;
}
