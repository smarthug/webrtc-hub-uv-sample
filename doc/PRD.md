server - ECOD + AutoARIMA 기반 POS 예지 장애 탐지 시스템, webrtc 로 데이터 수신 및 발신
client - 결과를 chart 로 보여주는 웹, webrtc 로 데이터 수신
webrtc_csharp_client - 실제 pos 장비, 자신의 정보를 webrtc 로 server 로 보냄


이번 prd 에는 sample 폴더에 있는 data_pos.txt 를 사용
server 가 webrtc_csharp_client 데이터를 받는다고 가정하고, 바로 txt 사용하기, 터미널에서 명령어로 sample 을 쓸지 , 실시간 webrtc 로 할지 결정하는걸로하기