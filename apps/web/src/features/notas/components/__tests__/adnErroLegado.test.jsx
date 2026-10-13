import {render,screen} from '@testing-library/react';
import {AdnCapturePanel} from '../AdnCapturePanel';
it('erro TLS antigo tem motivo e próximo passo sem expor stack OpenSSL',()=>{
 render(<AdnCapturePanel adnState={{adnLastError:'[NETWORK_ERROR] SSL routines:ssl3_get_record:decryption failed or bad record mac',adnLastAttemptAt:new Date().toISOString()}} somenteStatus/>);
 expect(screen.getByText(/A conexão segura com o ADN foi interrompida/)).toBeInTheDocument();
 expect(screen.queryByText(/ssl3_get_record/)).not.toBeInTheDocument();
 expect(screen.getByText(/da tentativa de/)).toBeInTheDocument();
});
