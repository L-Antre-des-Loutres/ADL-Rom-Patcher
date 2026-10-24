FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG PUBLIC_OAPI_URL=https://oapi.antredesloutres.fr/api
ENV PUBLIC_OAPI_URL=${PUBLIC_OAPI_URL}
RUN npm run build

FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
